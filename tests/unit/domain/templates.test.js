import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATE_KINDS,
  REQUIRED_DOCX_STYLES,
  bindTemplate,
  emptyRegistry,
  findTemplate,
  missingStyles,
  templateFor,
  templateKind,
  templateName,
  templateTarget,
  upsertTemplate,
} from '../../../src/domain/templates.js';
import { PhdudeError } from '../../../src/domain/errors.js';

const HASH = 'a'.repeat(64);

const entry = (over = {}) => ({
  name: 'thesis',
  kind: 'docx',
  path: 'templates/docx/thesis.docx',
  hash: HASH,
  ...over,
});

test('the kinds are the three a renderer can be handed', () => {
  assert.deepEqual(TEMPLATE_KINDS, ['docx', 'pptx', 'latex']);
});

test('a template name is the slug of the file it came from', () => {
  assert.equal(templateName('templates/university/Thesis Template.docx'), 'thesis-template');
  assert.equal(templateName('templates/IEEE_conf.tex'), 'ieee-conf');
});

test('a file whose name slugifies to nothing is a validation error', () => {
  assert.throws(() => templateName('templates/___.docx'), PhdudeError);
});

test('the kind is read from the extension when the researcher did not say', () => {
  assert.equal(templateKind('templates/a.docx'), 'docx');
  assert.equal(templateKind('templates/a.PPTX'), 'pptx');
  assert.equal(templateKind('templates/a.tex'), 'latex');
  assert.equal(templateKind('templates/a.latex'), 'latex');
});

test('a kind the researcher gave has to match the file it was given', () => {
  assert.equal(templateKind('templates/a.docx', 'docx'), 'docx');
  assert.throws(() => templateKind('templates/a.docx', 'pptx'), PhdudeError);
  assert.throws(() => templateKind('templates/a.odt'), PhdudeError);
  assert.throws(() => templateKind('templates/a.docx', 'odt'), PhdudeError);
});

test('a template is stored under its kind, keeping the extension it arrived with', () => {
  assert.equal(templateTarget('thesis', 'docx', 'x/Thesis.docx'), 'templates/docx/thesis.docx');
  assert.equal(templateTarget('ieee', 'latex', 'x/IEEE.latex'), 'templates/latex/ieee.latex');
});

test('an empty registry is a registry, not a missing file', () => {
  const registry = emptyRegistry();
  assert.equal(registry.schema, 'phdude.templates');
  assert.deepEqual(registry.templates, []);
  assert.equal(findTemplate(registry, 'thesis'), null);
});

test('registering the same name again replaces the entry and keeps the order', () => {
  let registry = upsertTemplate(emptyRegistry(), entry({ name: 'a' }));
  registry = upsertTemplate(registry, entry({ name: 'b', kind: 'pptx' }));
  registry = upsertTemplate(registry, entry({ name: 'a', hash: 'b'.repeat(64) }));

  assert.deepEqual(
    registry.templates.map((t) => t.name),
    ['a', 'b'],
  );
  assert.equal(findTemplate(registry, 'a').hash, 'b'.repeat(64));
});

test('a re-registration keeps the profile the template was already bound to', () => {
  let registry = upsertTemplate(emptyRegistry(), entry());
  registry = bindTemplate(registry, 'thesis', 'generic-thesis');
  registry = upsertTemplate(registry, entry({ hash: 'c'.repeat(64) }));
  assert.equal(findTemplate(registry, 'thesis').for, 'generic-thesis');
});

test('binding a template that was never registered is a validation error', () => {
  assert.throws(() => bindTemplate(emptyRegistry(), 'ghost', 'ieee'), PhdudeError);
});

test('the template for a profile is the one bound to it', () => {
  let registry = upsertTemplate(emptyRegistry(), entry({ name: 'plain', kind: 'pptx' }));
  registry = upsertTemplate(registry, entry({ name: 'ieee-slides', kind: 'pptx' }));
  registry = bindTemplate(registry, 'ieee-slides', 'ieee');

  assert.equal(templateFor(registry, { kind: 'pptx', profile: 'ieee' }).name, 'ieee-slides');
  assert.equal(templateFor(registry, { kind: 'docx', profile: 'ieee' }), null);
});

// With nothing bound there is one obvious answer only when there is one template of the kind;
// picking one of several would be PhDude deciding which template a researcher meant.
test('with nothing bound, one registered template of the kind is used and two are not', () => {
  const one = upsertTemplate(emptyRegistry(), entry({ name: 'plain', kind: 'pptx' }));
  assert.equal(templateFor(one, { kind: 'pptx', profile: 'ieee' }).name, 'plain');

  const two = upsertTemplate(one, entry({ name: 'fancy', kind: 'pptx' }));
  assert.equal(templateFor(two, { kind: 'pptx', profile: 'ieee' }), null);
});

test('the styles a DOCX template owes Pandoc are the five it writes with', () => {
  assert.deepEqual(REQUIRED_DOCX_STYLES, [
    'Heading 1',
    'Heading 2',
    'Heading 3',
    'Body Text',
    'Caption',
  ]);
});

// Word stores "heading 1" as the style *name* and "Heading1" as its id, and a template built in
// Word, in Pandoc or by hand may present either. Missing means neither is there.
test('a style counts as present under its Word name or its style id', () => {
  const names = ['heading 1', 'Heading2', 'Heading 3', 'BodyText', 'Caption'];
  assert.deepEqual(missingStyles(names), []);
});

test('the styles a template does not define are reported in the order they are required', () => {
  assert.deepEqual(missingStyles(['Normal', 'Heading2']), [
    'Heading 1',
    'Heading 3',
    'Body Text',
    'Caption',
  ]);
  assert.deepEqual(missingStyles([]), REQUIRED_DOCX_STYLES);
});
