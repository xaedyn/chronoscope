/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow raw visual values (hex, rgba, px, ms) outside tokens.ts' },
    messages: {
      noRawHex: 'Use design tokens — no raw hex color values.',
      noRawRgba: 'Use tokens.color.util.* — no raw rgba/rgb values.',
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        const val = node.value;

        // Hex colors
        if (/^#[0-9a-fA-F]{3,8}$/.test(val)) {
          context.report({ node, messageId: 'noRawHex' });
        }

        // rgba/rgb
        if (/^rgba?\(/.test(val)) {
          context.report({ node, messageId: 'noRawRgba' });
        }
      },
    };
  },
};
