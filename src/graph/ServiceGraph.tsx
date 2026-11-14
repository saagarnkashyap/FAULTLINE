import { Component, lazy, memo, Suspense } from "react";
import type { ReactNode } from "react";
import type { ServiceId, SimulationScenario, SimulationState } from "../simulation/types";
import type { GraphLayout } from "./displayLayout";

const CinematicGraph = lazy(() => import("./CinematicGraph"));

export function GraphUnavailable() {
  return (
    <div className="graph-message" role="status">
      <span className="graph-message-icon" aria-hidden="true">◇</span>
      <h3>3D view unavailable</h3>
      <p>This browser could not render the WebGL network. Select a service from the list to continue.</p>
      <p>Failure, repair, stepping, and the incident log remain available.</p>
    </div>
  );
}

class GraphErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <GraphUnavailable /> : this.props.children;
  }
}

export interface GraphProps {
  scenario: SimulationScenario;
  state: SimulationState;
  selectedId: ServiceId | null;
  onSelect: (id: ServiceId) => void;
  recentIds?: readonly ServiceId[];
  onLayout?: (layout: GraphLayout) => void;
}

export const ServiceGraph = memo(function ServiceGraph(props: GraphProps) {
  return <GraphErrorBoundary><Suspense fallback={<div className="graph-message" role="status">Loading the 3D network...</div>}><CinematicGraph {...props} /></Suspense></GraphErrorBoundary>;
});
