const normalized = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').replace(/\s+/g, ' ');

const roleRules: { skills: string[]; roles: string[] }[] = [
  { skills: ['react', 'react.js', 'reactjs', 'next.js', 'nextjs'], roles: ['React Developer', 'Frontend Developer', 'JavaScript Developer'] },
  { skills: ['html', 'html5', 'css', 'css3', 'javascript', 'js', 'typescript'], roles: ['Frontend Developer', 'Web Developer', 'JavaScript Developer'] },
  { skills: ['node.js', 'nodejs', 'express', 'nestjs'], roles: ['Node.js Developer', 'Backend Developer', 'JavaScript Developer'] },
  { skills: ['angular'], roles: ['Angular Developer', 'Frontend Developer', 'JavaScript Developer'] },
  { skills: ['vue', 'vue.js', 'vuejs'], roles: ['Vue.js Developer', 'Frontend Developer', 'JavaScript Developer'] },
  { skills: ['python', 'django', 'flask', 'fastapi'], roles: ['Python Developer', 'Backend Developer'] },
  { skills: ['java', 'spring', 'spring boot'], roles: ['Java Developer', 'Backend Developer'] },
  { skills: ['c#', '.net', 'asp.net'], roles: ['.NET Developer', 'Backend Developer'] },
  { skills: ['react native'], roles: ['React Native Developer', 'Mobile Application Developer'] },
  { skills: ['flutter', 'dart'], roles: ['Flutter Developer', 'Mobile Application Developer'] },
];

/** Grounded suggestions only: every returned role is supported by a confirmed skill rule. */
export function suggestRolesFromSkills(skills: string[], limit = 10) {
  const evidence = new Set(skills.map(normalized).filter(Boolean));
  const roles: string[] = [];
  for (const rule of roleRules) {
    if (!rule.skills.some(skill => evidence.has(skill))) continue;
    for (const role of rule.roles) if (!roles.includes(role)) roles.push(role);
  }
  return roles.slice(0, Math.max(0, Math.min(20, limit)));
}

export function roleSuggestionEvidence(skills: string[], jobTitle?: string) {
  const confirmedSkills = [...new Set(skills.map(skill => skill.trim()).filter(Boolean))];
  const roles = suggestRolesFromSkills(confirmedSkills);
  const title = normalized(jobTitle ?? '');
  const matchedRole = roles.find(role => title.includes(normalized(role).replace(/\.js/g, ''))) ?? roles.find(role => normalized(role).split(' ').some(token => token.length > 3 && title.includes(token))) ?? null;
  const matchedSkills = confirmedSkills.filter(skill => title.includes(normalized(skill).replace(/\.js/g, '')) || roles.some(role => role === matchedRole && roleRules.some(rule => rule.roles.includes(role) && rule.skills.includes(normalized(skill)))));
  return { roles, matchedRole, matchedSkills, source: 'confirmed_profile' as const };
}
