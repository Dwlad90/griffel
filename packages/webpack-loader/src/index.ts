import virtualModules from './virtualModules.js';
import { SourceMapSource, RawSource } from 'webpack-sources';

const NAME = 'Griffel';

export class GriffelPlugin {
  test = /\.css$/;
  constructor({ test = /\.css$/ } = {}) {
    this.test = test;
  }

  apply(compiler: any) {
    try {
      virtualModules.apply(compiler);

      compiler.hooks.compilation.tap(NAME, (compilation: any) => {
        if (compilation.hooks.processAssets) {
          console.log('!!!!!123');

          compilation.hooks.processAssets.tap(
            {
              name: NAME,
              stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
            },
            (assets: any) => {
              const paths = Object.keys(assets);

              this._processFiles(compilation, paths);
            },
          );
        } else {
          console.log('!!!!!4565');
          compilation.hooks.optimizeChunkAssets.tapPromise(NAME, async (chunks: any) => {
            const paths = Array.from(chunks)
              .map((chunk: any) => Array.from(chunk.files))
              .flat();

            this._processFiles(compilation, paths);
          });
        }
      });
    } catch (err) {
      console.log('!!!!wwww', err);
    }
  }

  _processFiles(compilation: any, paths: any) {
    try {
      const filteredPaths = paths.filter((path: any) => path.match(this.test));

      for (const path of filteredPaths) {
        const asset = compilation.assets[path];
        const { source, map } = asset.sourceAndMap();
        const postcssOpts = {
          to: path,
          from: path,
          map: { prev: map || false },
        };
        // const result = processCSS(source, postcssOpts);
        const result = source;

        // console.log('!!!!source', source);

        if (result.map) {
          compilation.assets[path] = new SourceMapSource(result.css, path, JSON.parse(result.map), source, map, true);
        } else {
          compilation.assets[path] = new RawSource(result);
        }
      }
    } catch (err) {
      console.log('!!!!eeee', err);
    }
  }
}

export { webpackLoader as default } from './webpackLoader';
