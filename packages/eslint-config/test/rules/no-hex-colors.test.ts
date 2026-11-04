import rule from '../../src/plugin/rules/no-hex-colors.js';
import { ruleTester } from './rule-tester.js';

function hexColor(color: string) {
  return { messageId: 'hexColor', data: { color } };
}

ruleTester.run('no-hex-colors', rule, {
  valid: [
    "const color = 'var(--color-text)';",
    "const hash = '#';",
    "const short = '#12';",
    "const odd = '#12345';",
    "const anchor = '#section';",
    "const entity = '&#123;';",
    "const fragment = 'booking#abc';",
    "const id = '#abc-def';",
    'const link = <a href="#add">Add</a>;',
    "const link = <a href={'#add'}>Add</a>;",
    'const link = <a href={`#add`}>Add</a>;',
    'const anchor = `#${sectionId}`;',
  ],
  invalid: [
    { code: "const color = '#fff';", errors: [hexColor('#fff')] },
    { code: "const color = '#FFFF';", errors: [hexColor('#FFFF')] },
    { code: "const border = '1px solid #000';", errors: [hexColor('#000')] },
    { code: "const color = '#11223344';", errors: [hexColor('#11223344')] },
    {
      code: "const box = <div style={{ color: '#1a2b3c' }} />;",
      errors: [hexColor('#1a2b3c')],
    },
    { code: 'const border = `1px solid #000`;', errors: [hexColor('#000')] },
    { code: 'const icon = <path fill="#abc" />;', errors: [hexColor('#abc')] },
    // Only href is exempt: elsewhere "#add" is a valid colour.
    { code: 'const label = <span title="#add" />;', errors: [hexColor('#add')] },
  ],
});
