// Synthetic violation in plain JavaScript: JSX in a .jsx file parses only with ecmaFeatures.jsx.
export function SyntheticNotice() {
  return <p className="pr-2">Synthetic notice</p>;
}
