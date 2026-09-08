import test from 'node:test';
import assert from 'node:assert/strict';
import { rendererFor } from '../../../src/domain/renderers.js';

const markdown = { name: 'markdown', formats: ['md'] };
const pandoc = { name: 'pandoc', formats: ['docx', 'pptx', 'html', 'latex', 'md'] };

test('the first renderer that claims the format wins', () => {
  assert.equal(rendererFor([markdown, pandoc], 'md').name, 'markdown');
  assert.equal(rendererFor([markdown, pandoc], 'docx').name, 'pandoc');
});

test('a renderer set given as a map is read in its own order', () => {
  assert.equal(rendererFor({ markdown, pandoc }, 'md').name, 'markdown');
  assert.equal(rendererFor({ pandoc, markdown }, 'md').name, 'pandoc');
});

test('a format nothing renders, and a missing renderer set, are both no renderer', () => {
  assert.equal(rendererFor([markdown, pandoc], 'epub'), null);
  assert.equal(rendererFor(undefined, 'docx'), null);
  assert.equal(rendererFor(null, 'docx'), null);
  assert.equal(rendererFor([], 'docx'), null);
});

test('an entry that is not a renderer is skipped rather than thrown over', () => {
  assert.equal(rendererFor([null, { name: 'broken' }, pandoc], 'docx').name, 'pandoc');
});
