'use client';

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { readBrowserApiPayload } from '@/lib/browser-api';
import type { Preferences } from '@/lib/domain';

type Location = {
  id: string;
  displayName: string;
  countryCode?: string;
  type: 'country' | 'region' | 'state' | 'province' | 'union_territory' | 'city';
};
type CatalogResponse = { data?: { items?: Location[]; nextCursor?: string | null }; error?: { message?: string } };
type MatchPreferences = Preferences & { cities?: string[]; revision: number };

const splitList = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);
const sameLocation = (value: string, location: Location) =>
  value === location.id || value.trim().toLocaleLowerCase() === location.displayName.trim().toLocaleLowerCase();

// The server deliberately caps each taxonomy page at 100. Follow its cursor so
// users are not silently limited to the first 100 countries or cities.
async function locations(query: URLSearchParams, signal?: AbortSignal) {
  const items = new Map<string, Location>();
  let after: string | null = null;
  for (let page = 0; page < 5; page++) {
    const pageQuery = new URLSearchParams(query);
    if (after) pageQuery.set('after', after);
    const response = await fetch('/api/v1/taxonomy/locations?' + pageQuery.toString(), { signal });
    const payload = await readBrowserApiPayload<CatalogResponse['data']>(response);
    if (!response.ok) throw new Error(payload.error?.message || 'Location choices are temporarily unavailable.');
    for (const item of payload.data?.items ?? []) items.set(item.id, item);
    after = payload.data?.nextCursor ?? null;
    if (!after) return [...items.values()];
  }
  // The catalog is capped at 500 entries. Do not present a partial location list
  // if a malformed response claims more pages than that bounded catalog permits.
  throw new Error('Location choices are temporarily unavailable.');
}

export function MatchPreferencesForm({ initial }: { initial: MatchPreferences }) {
  const [countries, setCountries] = useState<Location[]>([]);
  const [cities, setCities] = useState<Location[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>(initial.countries ?? []);
  const [selectedCities, setSelectedCities] = useState<string[]>(initial.cities ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(initial.revision);

  useEffect(() => {
    const controller = new AbortController();
    void locations(new URLSearchParams({ type: 'country', limit: '100' }), controller.signal)
      .then(setCountries)
      .catch(reason => {
        if ((reason as Error).name !== 'AbortError') { setError(true); setMessage((reason as Error).message); }
      });
    return () => controller.abort();
  }, []);

  const selectedCountryCodes = useMemo(
    () => [...new Set(selectedCountries.map(value => countries.find(country => sameLocation(value, country))?.countryCode).filter((value): value is string => Boolean(value)))],
    [countries, selectedCountries],
  );

  useEffect(() => {
    const controller = new AbortController();
    if (!selectedCountryCodes.length) return () => controller.abort();
    void Promise.all(selectedCountryCodes.map(countryCode =>
      locations(new URLSearchParams({ countryCode, type: 'city', limit: '100' }), controller.signal),
    )).then(groups => {
      if (controller.signal.aborted) return;
      const available = [...new Map(groups.flat().map(city => [city.id, city])).values()]
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      setCities(available);
      setSelectedCities(current => current.filter(value => available.some(city => sameLocation(value, city))));
    }).catch(reason => {
      if ((reason as Error).name !== 'AbortError') { setError(true); setMessage((reason as Error).message); }
    });
    return () => controller.abort();
  }, [selectedCountryCodes]);

  const toggle = (set: Dispatch<SetStateAction<string[]>>, location: Location) =>
    set(current => current.some(value => sameLocation(value, location))
      ? current.filter(value => !sameLocation(value, location))
      : [...current, location.id]);
  const toggleCountry = (country: Location) => {
    const next = selectedCountries.some(value => sameLocation(value, country))
      ? selectedCountries.filter(value => !sameLocation(value, country))
      : [...selectedCountries, country.id];
    const codes = new Set(next
      .map(value => countries.find(item => sameLocation(value, item))?.countryCode)
      .filter((value): value is string => Boolean(value)));
    setSelectedCountries(next);
    // A city can only be selected through a country in this editor. Clear
    // immediately when the final country is removed, even if an earlier city
    // catalog request has not finished yet.
    if (!codes.size) {
      setCities([]);
      setSelectedCities([]);
      return;
    }
    // Keep cities when another country is added, but remove only the cities
    // that belong to a country the candidate just removed.
    setSelectedCities(selected => selected.filter(value => {
      const city = cities.find(item => sameLocation(value, item));
      return !city?.countryCode || codes.has(city.countryCode);
    }));
  };

  async function submit(event: { preventDefault(): void; currentTarget: EventTarget & HTMLFormElement }) {
    event.preventDefault();
    setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    const formString = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const payload = {
      expectedRevision: revision,
      roles: splitList(formString('roles')),
      relatedRoles: splitList(formString('relatedRoles')),
      countries: selectedCountries,
      // Legacy city-only preferences can be read, but this country-first UI
      // never persists them after a save.
      cities: selectedCountryCodes.length ? selectedCities : [],
      modes: form.getAll('modes').filter((value): value is string => typeof value === 'string'),
      exclusions: splitList(formString('exclusions')),
      dailyCap: Number(formString('dailyCap') || initial.dailyCap),
      automation: form.get('automation') === 'on',
    };
    try {
      const response = await fetch('/api/v1/me/preferences', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await readBrowserApiPayload<MatchPreferences>(response);
      if (!response.ok) throw new Error(result.error?.message || 'Could not save your preferences.');
      setRevision(result.data?.revision ?? revision + 1);
      setError(false);
      setMessage('Your match preferences have been saved. Selected-city jobs will appear first in your matches.');
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : 'Could not save your preferences.');
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={submit}>
    <div className="form-grid">
      <label>Target job titles<input name="roles" defaultValue={(initial.roles ?? []).join(', ')} required /></label>
      <label>Accepted related roles<input name="relatedRoles" defaultValue={(initial.relatedRoles ?? []).join(', ')} /></label>
      <fieldset className="match-location-preferences">
        <legend>Preferred countries</legend>
        <p className="muted">Select countries first, then choose one or more cities. City matches rank above other eligible jobs in the same countries.</p>
        {countries.length ? <div className="match-location-options">
          {countries.map(country => <label key={country.id}>
            <input type="checkbox" checked={selectedCountries.some(value => sameLocation(value, country))} onChange={() => toggleCountry(country)} />
            {country.displayName}
          </label>)}
        </div> : <p className="muted">Loading country choices…</p>}
      </fieldset>
      {selectedCountries.length > 0 && <fieldset className="match-location-preferences">
        <legend>Preferred cities</legend>
        {cities.length ? <div className="match-location-options">
          {cities.map(city => <label key={city.id}>
            <input type="checkbox" checked={selectedCities.some(value => sameLocation(value, city))} onChange={() => toggle(setSelectedCities, city)} />
            {city.displayName}
          </label>)}
        </div> : <p className="muted">Loading cities for your selected countries…</p>}
      </fieldset>}
      <fieldset className="match-location-preferences">
        <legend>Work arrangements</legend>
        <div className="match-location-options">
          {['Remote', 'Hybrid', 'On-site'].map(mode => <label key={mode}>
            <input type="checkbox" name="modes" value={mode} defaultChecked={(initial.modes ?? []).includes(mode)} />{mode}
          </label>)}
        </div>
      </fieldset>
      <label>Excluded titles or employers<input name="exclusions" defaultValue={(initial.exclusions ?? []).join(', ')} /></label>
      <label>Your daily application cap<input name="dailyCap" type="number" min="0" defaultValue={initial.dailyCap} required /></label>
      <label style={{ gridColumn: '1/-1' }}><input name="automation" type="checkbox" defaultChecked={initial.automation} />Enable automatic applications with my explicit consent</label>
    </div>
    <div aria-live="polite">{message && <p className={'notice ' + (error ? 'error' : '')}>{message}</p>}</div>
    <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
  </form>;
}
