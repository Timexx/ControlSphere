const str = '{"type":"register"}';
console.log('Trying to parse:', str);
let depth = 0, endIdx = -1, inString = false, escaped = false;
for (let i = 0; i < str.length; i++) {
  const ch = str[i];
  console.log(`i=${i}, ch='${ch}', depth=${depth}, inString=${inString}, escaped=${escaped}`);
  if (escaped) { escaped = false; continue; }
  if (ch === '\\' && inString) { escaped = true; continue; }
  if (ch === '"') { inString = !inString; console.log(`  -> toggled inString to ${inString}`); continue; }
  if (!inString) {
    if (ch === '{') { depth++; console.log(`  -> incremented depth to ${depth}`); }
    else if (ch === '}') { depth--; console.log(`  -> decremented depth to ${depth}`); }
    if (depth === 0) { endIdx = i; break; }
  }
}
console.log('endIdx:', endIdx);
if (endIdx !== -1) {
  console.log('extracted:', str.substring(0, endIdx + 1));
}
