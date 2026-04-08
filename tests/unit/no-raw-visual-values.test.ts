import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-raw-visual-values.js';

// RuleTester registers its own describe/it blocks internally,
// so it must be called at the top level (not inside describe/it).
const ruleTester = new RuleTester({ languageOptions: { ecmaVersion: 2020 } });

ruleTester.run('no-raw-visual-values', rule, {
  valid: [
    { code: 'const color = tokens.color.surface.base;' },
    { code: 'const x = 42;' },
    { code: 'const s = "hello";' },
  ],
  invalid: [
    { code: 'const c = "#ff0000";', errors: [{ messageId: 'noRawHex' }] },
    { code: 'const c = "rgba(0,0,0,0.5)";', errors: [{ messageId: 'noRawRgba' }] },
    { code: 'const c = "#abc";', errors: [{ messageId: 'noRawHex' }] },
  ],
});
