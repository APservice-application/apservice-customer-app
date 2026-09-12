const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'customer', 'featured-stores-carousel.css'), 'utf8');
const entry = fs.readFileSync(path.join(root, 'customer', 'stores.html'), 'utf8');

assert.match(css, /featured-store-carousel-card__copy \{[\s\S]*?min-height: 64px;/, 'Featured store card copy must reserve space for two-line names');
assert.match(css, /featured-store-carousel-card__copy strong \{[\s\S]*?-webkit-line-clamp: 2;/, 'Featured store names must allow two lines before truncating');
assert.match(css, /@media \(max-width: 420px\)[\s\S]*?featured-store-carousel-card__copy \{ min-height: 61px; \}/, 'Small mobile cards must retain room for two-line names');
assert.match(entry, /featured-stores-carousel\.css\?v=featured-stores-v4-cover-image/, 'Stores page must request the two-line title stylesheet revision');

console.log('customer featured store title contract: PASS');
