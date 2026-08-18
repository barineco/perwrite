export function parseVscodeVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(value)
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null
}

/** `^1.120.0` 形式だけを検査 adapter の正規制約として受け入れる。 */
export function satisfiesVscodeVersion(version, constraint = '^1.120.0') {
  const actual = parseVscodeVersion(version)
  const required = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(constraint)
  if (!actual || !required) return false
  const [major, minor, patch] = required.slice(1).map(Number)
  return actual.major === major &&
    (actual.minor > minor || (actual.minor === minor && actual.patch >= patch))
}
