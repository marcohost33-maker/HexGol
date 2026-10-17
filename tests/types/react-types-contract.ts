import { createRoot, type Root } from "react-dom/client";
import type { ComponentProps, ReactNode } from "react";

type Assert<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;

type ButtonProps = ComponentProps<"button">;
type RootRenderArgument = Parameters<Root["render"]>[0];

// These assertions force the gate to consume both @types/react and
// @types/react-dom rather than merely resolving package names.
type _RootRenderAcceptsReactNode = Assert<
  IsAssignable<ReactNode, RootRenderArgument>
>;

const validButton: ButtonProps = {
  type: "button",
  disabled: false,
  children: "type contract",
};
void validButton;

// Negative controls are load-bearing: if React intrinsic-element types become
// unconstrained, @ts-expect-error becomes unused and TypeScript fails the gate.
// @ts-expect-error React button type accepts only the standard literal union.
const invalidButton: ButtonProps = { type: "definitely-not-a-button-type" };
void invalidButton;

declare const container: Element;
const root: Root = createRoot(container, { identifierPrefix: "ghx-type-contract" });
root.render("type-contract");

// @ts-expect-error react-dom/client requires identifierPrefix to be a string.
createRoot(container, { identifierPrefix: 42 });
