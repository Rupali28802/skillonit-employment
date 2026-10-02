// Push down only predicates whose JSON semantics match the repository matcher.
// Remaining operators are still evaluated by that matcher after the SQL read.
export function postgresReadFilter(query: Record<string, unknown>) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  let complete = true;
  const scalar = (value: unknown) => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
  const indexed = new Set(['status','sample','expiresAt','discoveredAt','sourcePostedAt']);
  const fieldFor = (key: string) => {
    if (indexed.has(key)) return `(data #> ARRAY['${key}'])`;
    values.push(key.split('.'));
    return `(data #> $${values.length + 1}::text[])`;
  };
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('$')) { complete = false; continue; }
    if (value && typeof value === 'object' && '$nin' in value && Array.isArray(value.$nin) && value.$nin.every(scalar)) {
      if (!value.$nin.length) continue;
      const field = fieldFor(key);
      const alternatives = value.$nin.map(candidate => {
        values.push(JSON.stringify(candidate));
        return `${field} <> $${values.length + 1}::jsonb`;
      });
      clauses.push(`(${field} IS NULL OR (${alternatives.join(' AND ')}))`);
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp)) {
      const range = value as Record<string, unknown>;
      const operators = Object.keys(range);
      const supported = operators.length > 0 && operators.every(operator => ['$gte', '$gt', '$lte', '$lt', '$ne'].includes(operator) && scalar(range[operator]));
      if (supported) {
        const field = fieldFor(key);
        const comparisons: string[] = [];
        for (const operator of operators) {
          values.push(JSON.stringify(range[operator]));
          const parameter = `$${values.length + 1}::jsonb`;
          if (operator === '$ne') comparisons.push(`(${field} IS NULL OR ${field} <> ${parameter})`);
          else comparisons.push(`${field} ${operator === '$gte' ? '>=' : operator === '$gt' ? '>' : operator === '$lte' ? '<=' : '<'} ${parameter}`);
        }
        clauses.push(`(${comparisons.join(' AND ')})`);
        continue;
      }
    }
    const candidates = scalar(value) ? [value] : value && typeof value === 'object' && '$in' in value && Array.isArray(value.$in) && value.$in.every(scalar) ? value.$in : null;
    if (!candidates) { complete = false; continue; }
    if (!candidates.length) { clauses.push('FALSE'); continue; }
    const field = fieldFor(key);
    const alternatives = candidates.map(candidate => {
      values.push(JSON.stringify(candidate));
      return `${field} = $${values.length + 1}::jsonb`;
    });
    clauses.push(`(${alternatives.join(' OR ')})`);
  }
  return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', values, complete };
}
