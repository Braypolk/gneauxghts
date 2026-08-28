import type { HTMLAttributes } from "svelte/elements";
import type { Snippet } from "svelte";
import type { Collapsible as CollapsiblePrimitive } from "bits-ui";

export type PlanProps = CollapsiblePrimitive.RootProps & {
	class?: string;
	children?: Snippet;
};

export type PlanHeaderProps = HTMLAttributes<HTMLDivElement> & {
	children?: Snippet;
};

export type PlanTitleProps = Omit<HTMLAttributes<HTMLHeadingElement>, "children"> & {
	children: Snippet;
};

export type PlanDescriptionProps = Omit<HTMLAttributes<HTMLParagraphElement>, "children"> & {
	children: Snippet;
};

export type PlanContentProps = HTMLAttributes<HTMLDivElement> & {
	children?: Snippet;
};

export type PlanTriggerProps = CollapsiblePrimitive.TriggerProps & {
	class?: string;
	children?: Snippet;
};
