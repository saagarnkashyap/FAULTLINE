import { LineCurve3, QuadraticBezierCurve3, Vector3 } from "three";
import type { GraphLink } from "./toGraphData";

/** A few explicit routing lanes keep actual dependencies clear of the service badges. */
export function linkCurvature(link: GraphLink): number {
  if (link.consumerId === "gateway-b" && link.providerId === "identity") return .28;
  if (link.consumerId === "documents" && link.providerId === "identity") return -.65;
  if (link.consumerId === "gateway" && link.providerId === "identity") return -.2;
  if (link.consumerId === "calendar" && link.providerId === "email") return .16;
  if (link.consumerId === "assistant" && link.providerId === "gateway") return -.5;
  if (link.consumerId === "gateway" && link.providerId === "gateway-b") return .2;
  return 0;
}

/** Same control-point convention used by three-forcegraph for its arrows and particles. */
export function dependencyCurve(link: GraphLink, start: Vector3, end: Vector3) {
  const amount = linkCurvature(link);
  if (!amount) return new LineCurve3(start, end);
  const control = end.clone().sub(start).multiplyScalar(amount).cross(new Vector3(0, 0, 1))
    .add(start.clone().add(end).multiplyScalar(.5));
  return new QuadraticBezierCurve3(start, control, end);
}
