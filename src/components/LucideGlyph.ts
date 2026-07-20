import type { IconNode } from "lucide";
import { defineComponent, h, type PropType } from "vue";

/**
 * Lucideのframework-independentなIconNodeをVueのVNodeへ変換します。
 *
 * Decision Spikeでは実製品と同じicon sourceを使いつつ、prototype固有の
 * component dependencyを増やさないための小さなadapterです。
 */
export default defineComponent({
  name: "LucideGlyph",
  props: {
    icon: {
      type: Array as PropType<IconNode>,
      required: true,
    },
    size: {
      type: Number,
      default: 20,
    },
  },
  setup(props) {
    return () =>
      h(
        "svg",
        {
          xmlns: "http://www.w3.org/2000/svg",
          width: props.size,
          height: props.size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": 2,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "aria-hidden": "true",
        },
        props.icon.map(([tag, attributes]) => h(tag, attributes)),
      );
  },
});
