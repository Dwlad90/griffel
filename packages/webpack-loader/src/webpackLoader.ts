import { configSchema, BabelPluginOptions } from '@griffel/babel-preset';
import { EvalCache, Module } from '@linaria/babel-preset';
import * as enhancedResolve from 'enhanced-resolve';
import { getOptions, interpolateName } from 'loader-utils';
import * as path from 'path';
import { validate } from 'schema-utils';
import * as webpack from 'webpack';
import virtualModules from './virtualModules.js';
import { pluginName, styleSheetName } from './extract-plugin';

import { transformSync, TransformResult, TransformOptions } from './transformSync';

export type WebpackLoaderOptions = BabelPluginOptions;

type WebpackLoaderParams = Parameters<webpack.LoaderDefinitionFunction<WebpackLoaderOptions>>;

export function shouldTransformSourceCode(
  sourceCode: string,
  modules: WebpackLoaderOptions['modules'] | undefined,
): boolean {
  // Fallback to "makeStyles" if options were not provided
  const imports = modules ? modules.map(module => module.importName).join('|') : 'makeStyles';

  return new RegExp(`\\b(${imports})`).test(sourceCode);
}

/**
 * Webpack can also pass sourcemaps as a string, Babel accepts only objects.
 * See https://github.com/babel/babel-loader/pull/889.
 */
function parseSourceMap(inputSourceMap: WebpackLoaderParams[1]): TransformOptions['inputSourceMap'] {
  try {
    if (typeof inputSourceMap === 'string') {
      return JSON.parse(inputSourceMap) as TransformOptions['inputSourceMap'];
    }

    return inputSourceMap as TransformOptions['inputSourceMap'];
  } catch (err) {
    return undefined;
  }
}

export function webpackLoader(
  this: webpack.LoaderContext<never>,
  sourceCode: WebpackLoaderParams[0],
  inputSourceMap: WebpackLoaderParams[1],
) {
  // Loaders are cacheable by default, but in there edge cases/bugs when caching does not work until it's specified:
  // https://github.com/webpack/webpack/issues/14946
  this.cacheable();

  const options = getOptions(this) as WebpackLoaderOptions;

  // validate(configSchema, options, {
  //   name: '@fluentui/make-styles-webpack-loader',
  //   baseDataPath: 'options',
  // });

  // Early return to handle cases when makeStyles() calls are not present, allows to avoid expensive invocation of Babel
  if (!shouldTransformSourceCode(sourceCode, options.modules)) {
    this.callback(null, sourceCode, inputSourceMap);
    return;
  }

  EvalCache.clearForFile(this.resourcePath);

  const resolveOptionsDefaults: webpack.ResolveOptions = {
    conditionNames: ['require'],
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
  };
  // ⚠ "this._compilation" limits loaders compatibility, however there seems to be no other way to access Webpack's
  // resolver.
  // There is this.resolve(), but it's asynchronous. Another option is to read the webpack.config.js, but it won't work
  // for programmatic usage. This API is used by many loaders/plugins, so hope we're safe for a while
  const resolveOptionsFromWebpackConfig: webpack.ResolveOptions = this._compilation?.options.resolve || {};

  const resolveSync = enhancedResolve.create.sync({
    ...resolveOptionsDefaults,
    alias: resolveOptionsFromWebpackConfig.alias,
    modules: resolveOptionsFromWebpackConfig.modules,
    plugins: resolveOptionsFromWebpackConfig.plugins,
  });

  const originalResolveFilename = Module._resolveFilename;

  let result: TransformResult | null = null;
  let error: Error | null = null;

  try {
    // We are evaluating modules in Babel plugin to resolve expressions (function calls, imported constants, etc.) in
    // makeStyles() calls, see evaluatePathsInVM.ts.
    // Webpack's config can define own module resolution, Babel plugin should use Webpack's resolution to properly
    // resolve paths.
    Module._resolveFilename = (id, { filename }) => {
      const resolvedPath = resolveSync(path.dirname(filename), id);

      if (!resolvedPath) {
        throw new Error(`enhanced-resolve: Failed to resolve module "${id}"`);
      }

      this.addDependency(resolvedPath);

      return resolvedPath;
    };

    result = transformSync(sourceCode, {
      filename: path.relative(process.cwd(), this.resourcePath),

      enableSourceMaps: this.sourceMap || false,
      inputSourceMap: parseSourceMap(inputSourceMap),

      pluginOptions: options,
    });
  } catch (err) {
    error = err as Error;
  } finally {
    // Restore original behaviour
    Module._resolveFilename = originalResolveFilename;
  }

  if (result) {
    if (!(result.metadata as any).style9) {
      this.callback(null, result.code, result.sourceMap);
    } else {
      this.cacheable(false);

      const virtualFileName = '[path][name].[hash:base64:7].griffel-css.css';

      const { code, sourceMap, metadata } = result;

      const cssPath = interpolateName(this, virtualFileName, {
        content: (metadata as any).style9,
      });

      console.log('!!!!cssPath', cssPath);

      // virtualModules.writeModule(cssPath, (metadata as any).style9);
      const inlineLoader = '';

      const postfix = `\nimport '${inlineLoader + cssPath}';`;
      this.callback(null, code, sourceMap);
    }
    return;
  }

  this.callback(error);
}

/**
 * Returns user configuration.
 *
 * @param context
 * @returns
 */
function getLoaderOptions(context: any) {
  const {
    bake = true,
    extract = false,
    importReact = undefined,
    nonce = undefined,
    resolve = {},
    extensions = undefined,
    babelPlugins = [],
    [pluginName]: isPluginEnabled = false,
  } = typeof context.getOptions === 'undefined'
    ? // Webpack v4 flow
      getOptions(context)
    : // Webpack v5 flow
      context.getOptions({
        type: 'object',
        properties: {
          bake: {
            type: 'boolean',
          },
          extract: {
            type: 'boolean',
          },
          importReact: {
            type: 'boolean',
          },
          nonce: {
            type: 'string',
          },
          resolve: {
            type: 'object',
          },
          extensions: {
            type: 'array',
          },
          babelPlugins: {
            type: 'array',
          },
          [pluginName]: {
            type: 'boolean',
          },
        },
      });

  return {
    bake,
    extract,
    importReact,
    nonce,
    resolve,
    extensions,
    babelPlugins,
    [pluginName]: isPluginEnabled,
  };
}

let hasErrored = false;

export function pitch(this: any): void {
  const options = getLoaderOptions(this);
  if (!hasErrored && options.extract && !options[pluginName]) {
    this.emitError(
      new Error(
        'webpack-loader' +
          `You forgot to add the 'CompiledExtractPlugin' plugin (i.e \`{ plugins: [new CompiledExtractPlugin()] }\`), please read https://compiledcssinjs.com/docs/css-extraction-webpack`,
      ),
    );

    // We only want to error once, if we didn't do this you'd get an error for every file found.
    hasErrored = true;
  }
}
