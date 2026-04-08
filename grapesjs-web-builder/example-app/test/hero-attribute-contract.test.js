import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { compile, parse } from 'svelte/compiler';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const litHeroPath = path.join(appRoot, 'src/lib/components/BuilderHeroLit.ts');
const svelteHeroPath = path.join(appRoot, 'src/lib/components/BuilderHeroSvelte.ce.svelte');

const expectedAttributes = {
  headline: 'headline',
  subheadline: 'subheadline',
  theme: 'theme',
  align: 'align',
  surface: 'surface',
  accent: 'accent',
  spaceY: 'space-y'
};

function getLiteralValue(node) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  return undefined;
}

function getDecoratorName(decorator, sourceFile) {
  const expression = decorator.expression;
  if (ts.isCallExpression(expression)) {
    return expression.expression.getText(sourceFile);
  }
  return expression.getText(sourceFile);
}

function readLitPropertyContract(source) {
  const sourceFile = ts.createSourceFile('BuilderHeroLit.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const contract = {};

  function visit(node) {
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      const decorators = ts.getDecorators(node) ?? [];
      const propertyDecorator = decorators.find((decorator) => getDecoratorName(decorator, sourceFile) === 'property');

      if (propertyDecorator && ts.isCallExpression(propertyDecorator.expression)) {
        const [firstArg] = propertyDecorator.expression.arguments;
        const propName = node.name.text;
        const details = {};

        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
          for (const property of firstArg.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
            ) {
              const key = ts.isIdentifier(property.name) ? property.name.text : property.name.text;
              details[key] = getLiteralValue(property.initializer);
            }
          }
        }

        contract[propName] = details;
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return contract;
}

function readSvelteCustomElementContract(source) {
  const ast = parse(source, {
    filename: 'BuilderHeroSvelte.ce.svelte',
    modern: true
  });

  return ast.options?.customElement?.props ?? {};
}

test('Lit Hero exposes the full expected reflected attribute contract', async () => {
  const source = await readFile(litHeroPath, 'utf8');
  const contract = readLitPropertyContract(source);

  for (const [prop, attribute] of Object.entries(expectedAttributes)) {
    assert.ok(contract[prop], `Expected Lit Hero to define property metadata for "${prop}"`);
    assert.equal(contract[prop].type, 'String', `Expected Lit Hero "${prop}" to be typed as String`);
    assert.equal(contract[prop].reflect, true, `Expected Lit Hero "${prop}" to reflect`);

    if (prop === attribute) {
      assert.ok(
        contract[prop].attribute === undefined || contract[prop].attribute === attribute,
        `Expected Lit Hero "${prop}" to use implicit attribute "${attribute}" or declare it explicitly`
      );
    } else {
      assert.equal(
        contract[prop].attribute,
        attribute,
        `Expected Lit Hero "${prop}" to map to attribute "${attribute}"`
      );
    }
  }
});

test('Svelte Hero exposes the full expected reflected attribute contract', async () => {
  const source = await readFile(svelteHeroPath, 'utf8');
  const contract = readSvelteCustomElementContract(source);

  for (const [prop, attribute] of Object.entries(expectedAttributes)) {
    assert.ok(contract[prop], `Expected Svelte Hero to define property metadata for "${prop}"`);
    assert.equal(contract[prop].type, 'String', `Expected Svelte Hero "${prop}" to be typed as String`);
    assert.equal(contract[prop].reflect, true, `Expected Svelte Hero "${prop}" to reflect`);

    if (prop === attribute) {
      assert.ok(
        contract[prop].attribute === undefined || contract[prop].attribute === attribute,
        `Expected Svelte Hero "${prop}" to use implicit attribute "${attribute}" or declare it explicitly`
      );
    } else {
      assert.equal(
        contract[prop].attribute,
        attribute,
        `Expected Svelte Hero "${prop}" to map to attribute "${attribute}"`
      );
    }
  }
});

test('compiled Svelte Hero contains the full expected attribute contract', async () => {
  const source = await readFile(svelteHeroPath, 'utf8');
  const result = compile(source, {
    filename: 'BuilderHeroSvelte.ce.svelte',
    customElement: true
  });

  for (const attribute of Object.values(expectedAttributes)) {
    assert.match(
      result.js.code,
      new RegExp(attribute.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')),
      `Expected compiled Svelte Hero to include attribute "${attribute}"`
    );
  }
});
