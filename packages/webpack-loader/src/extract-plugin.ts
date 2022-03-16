import virtualModules from './virtualModules.js';
import { SourceMapSource, RawSource } from 'webpack-sources';
import { Compilation, Compiler } from 'webpack';
import type { CompiledExtractPluginOptions } from './types';
import { getOptimizeAssetsHook, getSources, setPluginConfiguredOption, getAssetSourceContents } from './utils.js';

const NAME = 'Griffel';

export const pluginName = 'GriffelExtractPlugin';
export const styleSheetName = 'griffel-css';

/**
 * Returns CSS Assets that we're interested in.
 *
 * @param options
 * @param assets
 * @returns
 */
const getCSSAssets = (assets: Compilation['assets']) => {
  return Object.keys(assets)
    .filter(assetName => {
      console.log('!!!!!! assetName', assetName);

      return assetName.endsWith(`${styleSheetName}.css`);
      // return assetName.endsWith(`.css`);
    })
    .map(assetName => ({ name: assetName, source: assets[assetName], info: {} }));
};

/**
 * Pushes a new loader onto the compiler.
 * The loader will be applied to all JS files found in node modules that import `@compiled/react`.
 *
 * @param compiler
 */
const pushNodeModulesExtractLoader = (compiler: Compiler, options: CompiledExtractPluginOptions): void => {
  if (!compiler.options.module) {
    throw new Error('module options not defined');
  }

  compiler.options.module.rules.push({
    test: { and: [/node_modules.+\.js$/, options.nodeModulesTest].filter(Boolean) as any },
    include: options.nodeModulesInclude,
    exclude: options.nodeModulesExclude,
    use: {
      loader: '@compiled/webpack-loader',
      options: {
        // We turn off baking as we're only interested in extracting from node modules (they're already baked)!
        bake: false,
        extract: true,
        [pluginName]: true,
      },
    },
  });
};

/**
 * Set a cache group to force all CompiledCSS found to be in a single style sheet.
 * We do this to simplify the sorting story for now. Later on we can investigate
 * hoisting only unstable styles into the parent style sheet from async chunks.
 *
 * @param compiler
 */
const forceCSSIntoOneStyleSheet = (compiler: Compiler) => {
  const cacheGroup = {
    griffleCSS: {
      name: styleSheetName,
      type: 'css/mini-extract',
      chunks: 'all',
      // We merge only CSS from Compiled.
      test: /css-loader\/griffle-css\.css$/,
      enforce: true,
    },
  };

  if (!compiler.options.optimization) {
    compiler.options.optimization = {};
  }

  if (!compiler.options.optimization.splitChunks) {
    compiler.options.optimization.splitChunks = {
      cacheGroups: {},
    };
  }

  if (!compiler.options.optimization.splitChunks.cacheGroups) {
    compiler.options.optimization.splitChunks.cacheGroups = {};
  }

  Object.assign(compiler.options.optimization.splitChunks.cacheGroups, cacheGroup);
};

export class GriffelPlugin {
  #options: CompiledExtractPluginOptions;

  constructor(options: CompiledExtractPluginOptions = {}) {
    this.#options = options;
  }

  apply(compiler: Compiler): void {
    // virtualModules.apply(compiler);
    const { RawSource } = getSources(compiler);

    pushNodeModulesExtractLoader(compiler, this.#options);
    forceCSSIntoOneStyleSheet(compiler);

    compiler.hooks.compilation.tap(pluginName, compilation => {
      setPluginConfiguredOption(compilation.options.module.rules, pluginName);

      getOptimizeAssetsHook(compiler, compilation).tap(pluginName, assets => {
        const cssAssets = getCSSAssets(assets);
        if (cssAssets.length === 0) {
          return;
        }
        const [asset] = cssAssets;
        const contents = getAssetSourceContents(asset.source);
        const newSource = new RawSource(contents);

        compilation.updateAsset(asset.name, newSource, asset.info);
      });
    });
  }
}
// export class GriffelPlugin {
//   test = /\.css$/;
//   constructor({ test = /\.css$/ } = {}) {
//     this.test = test;
//   }

//   apply(compiler: any) {
//     try {
//       virtualModules.apply(compiler);

//       compiler.hooks.compilation.tap(NAME, (compilation: any) => {
//         if (compilation.hooks.processAssets) {
//           console.log('!!!!!123');

//           compilation.hooks.processAssets.tap(
//             {
//               name: NAME,
//               stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
//             },
//             (assets: any) => {
//               const paths = Object.keys(assets);

//               this._processFiles(compilation, paths);
//             },
//           );
//         } else {
//           console.log('!!!!!4565');
//           compilation.hooks.optimizeChunkAssets.tapPromise(NAME, async (chunks: any) => {
//             const paths = Array.from(chunks)
//               .map((chunk: any) => Array.from(chunk.files))
//               .flat();

//             this._processFiles(compilation, paths);
//           });
//         }
//       });
//     } catch (err) {
//       console.log('!!!!wwww', err);
//     }
//   }

//   _processFiles(compilation: any, paths: any) {
//     try {
//       const filteredPaths = paths.filter((path: any) => path.match(this.test));

//       for (const path of filteredPaths) {
//         const asset = compilation.assets[path];
//         const { source, map } = asset.sourceAndMap();
//         const postcssOpts = {
//           to: path,
//           from: path,
//           map: { prev: map || false },
//         };
//         // const result = processCSS(source, postcssOpts);
//         const result = source;

//         // console.log('!!!!source', source);

//         if (result.map) {
//           compilation.assets[path] = new SourceMapSource(result.css, path, JSON.parse(result.map), source, map, true);
//         } else {
//           compilation.assets[path] = new RawSource(result);
//         }
//       }
//     } catch (err) {
//       console.log('!!!!eeee', err);
//     }
//   }
// }
