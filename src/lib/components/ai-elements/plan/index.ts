import Plan from "./plan.svelte";
import PlanHeader from "./plan-header.svelte";
import PlanTitle from "./plan-title.svelte";
import PlanDescription from "./plan-description.svelte";
import PlanContent from "./plan-content.svelte";
import PlanTrigger from "./plan-trigger.svelte";

export type {
	PlanProps,
	PlanHeaderProps,
	PlanTitleProps,
	PlanDescriptionProps,
	PlanContentProps,
	PlanTriggerProps,
} from "./types.js";

export {
	Plan,
	PlanHeader,
	PlanTitle,
	PlanDescription,
	PlanContent,
	PlanTrigger,
	Plan as Root,
	PlanTrigger as Trigger,
	PlanContent as Content,
	PlanHeader as Header,
	PlanTitle as Title,
	PlanDescription as Description,
};
