import { declare } from '@babel/helper-plugin-utils';
import template from '@babel/template';
import type { NodePath } from '@babel/traverse';
import { isCCComponent } from './utils/is-cc-component';

import { isAutomaticRuntime } from './utils/is-automatic-runtime';
import { isCreateElement } from './utils/is-create-element';
import { removeStyleDeclarations } from './utils/remove-style-declarations';
import * as t from '@babel/types';

export const preserveLeadingComments = (path: any): void => {
  const leadingComments = path.node.body?.[0]?.leadingComments;

  if (leadingComments) {
    path.addComments('leading', leadingComments as any);

    path.node.body[0].leadingComments = null;
  }
};

/**
 * Escapes a CSS rule to be a valid query param.
 * Also escapes escalamation marks (!) to not confuse webpack.
 *
 * @param rule
 * @returns
 */
export const toURIComponent = (rule: string): string => {
  const component = encodeURIComponent(rule).replace(/!/g, '%21');

  return component;
};

export default declare<any>(api => {
  console.log('!!!!!!strip0000');
  api.assertVersion(7);

  return {
    name: '@griffel/babel-plugin-strip',
    pre() {
      this['styleRules'] = [];
    },
    visitor: {
      Program: {
        exit(path) {
          // console.log('!!!!!!strip', path);

          if (this && (this.opts as any).styleSheetPath) {
            preserveLeadingComments(path);
            // console.log('!!!!!!strip2', (this.opts as any).styleSheetPath, (this as any)['styleRules'] || [], path);

            ((this as any)['styleRules'] || []).forEach((rule: string) => {
              // Each found atomic rule will create a new import that uses the styleSheetPath provided.
              // The benefit is two fold:
              // (1) thread safe collection of styles
              // (2) caching -- resulting in faster builds (one import per rule!)
              const params = toURIComponent(rule);
              path.unshiftContainer(
                'body',
                template.ast(`require("${(this.opts as any).styleSheetPath}?style=${params}");`),
              );
              // We use require instead of import so it works with both ESM and CJS source.
              // If we used ESM it would blow up with CJS source, unfortunately.
            });
          }
        },
      },

      ImportSpecifier(path) {
        // console.log('!!!!!!ImportSpecifier', path);
        if (t.isIdentifier(path.node.imported) && ['CC', 'CS'].includes(path.node.imported.name)) {
          path.remove();
        }
      },
      JSXElement(path, pass) {
        // console.log('!!!!!!JSXElement', path);

        if (!t.isJSXIdentifier(path.node.openingElement.name)) {
          return;
        }

        const componentName = path.node.openingElement.name.name;
        if (componentName !== 'CC') {
          return;
        }

        const [, compiledStyles, , nodeToReplace] = path.get('children');

        // Before we replace this node with its children we need to go through and remove all the
        // style declarations from the CS call.
        removeStyleDeclarations(compiledStyles.node, path, pass);

        if (t.isJSXExpressionContainer(nodeToReplace.node)) {
          const container = nodeToReplace as NodePath<t.JSXExpressionContainer>;
          path.replaceWith(container.node.expression);
        } else {
          path.replaceWith(nodeToReplace);
        }

        // All done! Let's replace this node with the user land child.
        path.node.leadingComments = null;
        return;
      },
      CallExpression(path, pass) {
        // console.log('!!!!!!CallExpression', path);
        const callee = path.node.callee;
        if (isCreateElement(callee)) {
          // We've found something that looks like React.createElement(...)
          // Now we want to check if it's from the Compiled Runtime and if it is - replace with its children.
          const component = path.node.arguments[0];
          if (!isCCComponent(component)) {
            return;
          }

          const [, , compiledStyles, nodeToReplace] = path.get('arguments');

          // Before we replace this node with its children we need to go through and remove all the
          // style declarations from the CS call.
          removeStyleDeclarations(compiledStyles.node, path, pass);

          // All done! Let's replace this node with the user land child.
          path.replaceWith(nodeToReplace);
          path.node.leadingComments = null;
          return;
        }

        if (isAutomaticRuntime(path.node, 'jsxs')) {
          // We've found something that looks like _jsxs(...)
          // Now we want to check if it's from the Compiled Runtime and if it is - replace with its children.
          const component = path.node.arguments[0];
          if (!isCCComponent(component)) {
            return;
          }

          const [, props] = path.get('arguments');
          if (!t.isObjectExpression(props.node)) {
            return;
          }

          const children = props.node.properties.find((prop): prop is t.ObjectProperty => {
            return t.isObjectProperty(prop) && t.isIdentifier(prop.key) && prop.key.name === 'children';
          });

          if (!children || !t.isArrayExpression(children.value)) {
            return;
          }

          const [compiledStyles, nodeToReplace] = children.value.elements;
          if (!t.isExpression(nodeToReplace) || !t.isExpression(compiledStyles)) {
            throw new Error('Nodes should be expressions.');
          }

          // Before we replace this node with its children we need to go through and remove all the
          // style declarations from the CS call.
          removeStyleDeclarations(compiledStyles, path, pass);

          // All done! Let's replace this node with the user land child.
          path.replaceWith(nodeToReplace);
          path.node.leadingComments = null;
          return;
        }
      },
    },
  };
});
