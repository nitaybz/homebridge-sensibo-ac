// import stylistic from 'stylistic'
const globals = require('globals')
const js = require('@eslint/js')
const stylistic = require('@stylistic/eslint-plugin')

module.exports = [
	js.configs.recommended,
	{
		// files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
		// ignores: ['**/node_modules/', '.git/'],
		// ...js.configs.recommended,
		// files: ['**/api.js'],
		// ignores: ['index.js'],
		languageOptions: {
			ecmaVersion: 13,
			globals: { ...globals.node },
			sourceType: 'commonjs'
		},
		linterOptions: { reportUnusedDisableDirectives: true },
		plugins: { 'stylistic': stylistic },
		rules: {
			// 'no-async-promise-executor': 'error',
			'arrow-body-style': [
				'error',
				'always'
			],
			'curly': [
				'error',
				'all'
			],
			'no-constant-binary-expression': [
				'error'
			],
			'no-label-var': [
				'error'
			],
			'no-use-before-define': [
				'error',
				{
					'functions': false,
					'classes': true,
					'variables': true,
					'allowNamedExports': false
				}
			],
			'prefer-const': [
				'error',
				{
					'destructuring': 'any',
					'ignoreReadBeforeAssign': false
				}
			],
			'stylistic/block-spacing': [
				'error',
				'always'
			],
			'stylistic/brace-style': [
				'error',
				'1tbs',
				{ 'allowSingleLine': false }
			],
			'stylistic/indent': [
				'error',
				'tab',
				{ 'SwitchCase': 1 }
			],
			'stylistic/linebreak-style': [
				'error',
				'unix'
			],
			'stylistic/lines-between-class-members': [
				'error',
				'always'
			],
			'stylistic/multiline-ternary': [
				'error',
				'never'
			],
			'stylistic/no-multiple-empty-lines': [
				'error',
				{ 'max': 1 }
			],
			'stylistic/no-trailing-spaces': [
				'error',
				{ 'skipBlankLines': false }
			],
			'stylistic/object-curly-newline': [
				'error',
				{
					'minProperties': 2,
					'multiline': true
				}
			],
			'stylistic/object-curly-spacing': [
				'error',
				'always'
			],
			'stylistic/object-property-newline': [
				'error',
				{ 'allowAllPropertiesOnSameLine': false }
			],
			'stylistic/padded-blocks': [
				'error',
				{
					'blocks': 'never',
					'classes': 'always',
					'switches': 'never'
				}
			],
			'stylistic/padding-line-between-statements': [
				'error',
				{
					'blankLine': 'always',
					'prev': '*',
					'next': 'return'
				},
				{
					'blankLine': 'always',
					'prev': ['const', 'let', 'var'],
					'next': '*'
				},
				{
					'blankLine': 'never',
					'prev': ['const', 'let', 'var'],
					'next': ['const', 'let', 'var']
				}
			],
			'stylistic/quotes': [
				'error',
				'single'
			],
			'stylistic/semi': [
				'error',
				'never'
			],
			'stylistic/space-before-blocks': [
				'error',
				'always'
			],
			'stylistic/space-in-parens': [
				'error',
				'never'
			]
		}
	}
]