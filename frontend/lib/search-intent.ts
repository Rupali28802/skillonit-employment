export function searchIntent(input: string, countries: string[]) {
  const highSalary=/\b(?:good|high|competitive) salary\b/i.test(input);
  let role = input.trim();
  role=role.replace(/\bUSA\b/ig,'United States').replace(/\bUK\b/ig,'United Kingdom').replace(/\bUAE\b/ig,'United Arab Emirates');
  const remove = (pattern: RegExp) => { role = role.replace(pattern, ' '); };
  const location = [...countries].sort((a,b)=>b.length-a.length).find(c => new RegExp('\\b'+c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(role)) || '';
  if (location) remove(new RegExp('\\b'+location.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','ig'));
  const mode = /\bremote\b/i.test(role) ? 'Remote' : /\bhybrid\b/i.test(role) ? 'Hybrid' : /\bon[ -]site\b/i.test(role) ? 'On-site' : '';
  const fresher = /\bfreshers?\b|\bentry[ -]level\b/i.test(role);
  remove(/\bI am\b|\blooking for\b|\bwith (?:a )?(?:good|high|competitive) salary\b/ig);
  remove(/\b(remote|hybrid|on[ -]site|freshers?|entry[ -]level|jobs?|for|in|find|me|show|a|worldwide)\b/ig);
  role = role.replace(/[,;.!?]+/g,' ').replace(/\s+/g,' ').trim();
  return {role, country:location, mode, experience:fresher?'0':'',highSalary};
}
