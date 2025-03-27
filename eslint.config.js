// "Flat" config using sourceType: 'module'
import globals from 'globals'
import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'

export default [
	js.configs.recommended,
	// stylistic.configs comes from https://github.com/eslint-stylistic/eslint-stylistic/blob/main/packages/eslint-plugin/configs/customize.ts
	// Note: some of the config defaults don't align with documentation defaults
	stylistic.configs.customize({
		// the following options are the default values
		arrowParens: false,
		blockSpacing: true,
		braceStyle: '1tbs',
		commaDangle: 'never',
		flat: true,
		indent: 'tab',
		jsx: false,
		pluginName: 'stylistic',
		quoteProps: 'consistent-as-needed',
		quotes: 'single',
		semi: false
	}),
	{
		// files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
		// ignores: ['**/node_modules/', '.git/'],
		// ...js.configs.recommended,
		// files: ['**/api.js'],
		// ignores: ['index.js'],
		// TODO: should we set environment as node?
		languageOptions: {
			ecmaVersion: 'latest',
			globals: { ...globals.node },
			sourceType: 'module'
		},
		linterOptions: { reportUnusedDisableDirectives: true },
		plugins: { stylistic: stylistic },
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
			'no-duplicate-imports': [
				'error'
			],
			'no-label-var': [
				'error'
			],
			'no-self-compare': [
				'error'
			],
			'no-unreachable-loop': [
				'error'
			],
			'no-useless-assignment': [
				'error'
			],
			'no-use-before-define': [
				'error',
				{
					functions: true,
					classes: true,
					variables: true,
					allowNamedExports: false
				}
			],
			'prefer-const': [
				'error',
				{
					destructuring: 'any',
					ignoreReadBeforeAssign: false
				}
			],
			'require-atomic-updates': [
				'error'
			],
			// TODO: to be checked! 'stylistic/arrow-parens': ['error', 'as-needed', { requireForBlockBody: true }],
			'stylistic/arrow-parens': [
				'error',
				'as-needed'
			],
			'stylistic/brace-style': [
				'error',
				'1tbs',
				{ allowSingleLine: false }
			],
			'stylistic/linebreak-style': [
				'error',
				'unix'
			],
			'stylistic/lines-between-class-members': [
				'error',
				'always',
				{ exceptAfterSingleLine: false }
			],
			'stylistic/object-curly-newline': [
				'error',
				{
					minProperties: 2,
					multiline: true
				}
			],
			'stylistic/object-property-newline': [
				'error',
				{ allowAllPropertiesOnSameLine: false }
			],
			'stylistic/padded-blocks': [
				'error',
				{
					blocks: 'never',
					classes: 'always',
					switches: 'never'
				}
			],
			'stylistic/padding-line-between-statements': [
				'error',
				{
					blankLine: 'always',
					prev: '*',
					next: 'return'
				},
				{
					blankLine: 'always',
					prev: ['const', 'let', 'var'],
					next: '*'
				},
				{
					blankLine: 'never',
					prev: ['const', 'let', 'var'],
					next: ['const', 'let', 'var']
				}
			]
		}
	}
]
