import * as assert from 'node:assert/strict';
import { manifestDependencies, MANIFEST_FOR } from '../../src/manifests';

const names = (file: string, text: string): string[] => manifestDependencies(file, text).map((d) => d.name);

describe('manifestDependencies', () => {
  it('reads pyproject.toml (PEP 621, groups, Poetry)', () => {
    const text = `[project]
name = "app"
dependencies = [
    "Flask==3.0.3",
    'requests[socks]>=2; python_version > "3.8"',
]

[project.optional-dependencies]
cli = ["click>=8"]

[dependency-groups]
dev = ["pytest>=8"]

[tool.poetry.dependencies]
python = ">=3.11"
Typing_Extensions = "^4"

[tool.uv]
dev-dependencies = ["not-this"]
`;
    const deps = manifestDependencies('pyproject.toml', text);
    assert.deepEqual(deps.map((d) => d.name), ['flask', 'requests', 'click', 'pytest', 'typing-extensions']);
    for (const d of deps) {
      assert.equal(text.slice(d.start, d.end).toLowerCase().replace(/[_.]/g, '-'), d.name);
    }
  });

  it('reads composer.json without platform requirements', () => {
    const text = '{"require": {"php": ">=8.2", "ext-json": "*", "Monolog/Monolog": "^3"}, "require-dev": {"phpunit/phpunit": "^11"}}';
    assert.deepEqual(names('composer.json', text), ['monolog/monolog', 'phpunit/phpunit']);
  });

  it('reads requirements.txt and Pipfile', () => {
    assert.deepEqual(names('requirements.txt', '# deps\n-r base.txt\nDjango==5.1 \\\n  --hash=sha256:aa\nzope.interface>=6\n'), ['django', 'zope-interface']);
    assert.deepEqual(names('Pipfile', '[[source]]\nurl = "x"\n\n[packages]\nrequests = "*"\n\n[dev-packages]\npytest = "*"\n'), ['requests', 'pytest']);
  });

  it('maps every lockfile to a manifest', () => {
    assert.equal(MANIFEST_FOR['uv.lock'], 'pyproject.toml');
    assert.equal(MANIFEST_FOR['composer.lock'], 'composer.json');
    assert.equal(MANIFEST_FOR['package-lock.json'], 'package.json');
  });
});
