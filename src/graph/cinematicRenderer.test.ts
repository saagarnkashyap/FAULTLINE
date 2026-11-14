import { describe, expect, it, vi } from "vitest";
import { AdditiveBlending, LineSegments, Mesh, MeshBasicMaterial, PerspectiveCamera, ShaderMaterial, TubeGeometry, Vector2, Vector3 } from "three";
import { createCinematicRenderer } from "./cinematicRenderer";
import { createDisplayGraph, placeGraphLabels } from "./displayLayout";
import { failchainScenario } from "../scenarios/failchain";
import { initializeSimulation, step } from "../simulation/engine";
import { UI_COLORS } from "../theme";

function core(object: ReturnType<ReturnType<typeof createCinematicRenderer>["linkObject"]>) {
  const mesh = object.children[1];
  if (!(mesh instanceof Mesh) || !(mesh.material instanceof MeshBasicMaterial)) throw new Error("Missing luminous core");
  return mesh;
}

describe("cinematic Three.js presentation", () => {
  it("reuses core/halo objects across status and selection changes without mutating model inputs", () => {
    const graph = createDisplayGraph(failchainScenario);
    const visuals = createCinematicRenderer(graph);
    const link = graph.links.find(({ consumerId, providerId }) => consumerId === "gateway" && providerId === "identity")!;
    const object = visuals.linkObject(link);
    const mesh = core(object);
    const halo = object.children[0];
    expect(halo).toBeInstanceOf(Mesh);
    if (!(halo instanceof Mesh) || !(halo.material instanceof ShaderMaterial)) throw new Error("Missing shader halo");
    expect(halo.material.blending).toBe(AdditiveBlending);
    expect(halo.material.depthWrite).toBe(false);
    expect(halo.scale.x).toBeGreaterThan(mesh.scale.x * 5);
    let state = initializeSimulation(failchainScenario);
    const before = structuredClone(state);
    visuals.update(state, "gateway", false);
    Reflect.apply(mesh.onBeforeRender, mesh, []);
    expect(mesh.material.color.getHexString()).toBe(UI_COLORS.brand.slice(1).toLowerCase());
    expect(state).toEqual(before);
    state = step(failchainScenario, state, { type: "fail", serviceId: "identity" });
    const failed = structuredClone(state);
    const positions = graph.nodes.map(({ x, y, z }) => [x, y, z]);
    visuals.update(state, "calendar", false);
    Reflect.apply(mesh.onBeforeRender, mesh, []);
    expect(mesh.material.color.getHexString()).toBe(UI_COLORS.offline.slice(1).toLowerCase());
    expect(visuals.linkObject(link)).toBe(object);
    expect(graph.nodes.map(({ x, y, z }) => [x, y, z])).toEqual(positions);
    expect(state).toEqual(failed);
    expect(state.services.gateway!.status).toBe("healthy");
    visuals.dispose();
  });

  it("positions a cached cylinder along the real start-to-end vector and handles coincident endpoints", () => {
    const graph = createDisplayGraph(failchainScenario);
    const visuals = createCinematicRenderer(graph);
    const object = visuals.linkObject(graph.links.find(({ consumerId }) => consumerId === "email")!);
    visuals.positionLink(object, { start: { x: 1, y: 2, z: 3 }, end: { x: 4, y: 6, z: 3 } });
    expect(object.position.toArray()).toEqual([2.5, 4, 3]);
    expect(object.scale.y).toBe(5);
    expect(new Vector3(0, 1, 0).applyQuaternion(object.quaternion).distanceTo(new Vector3(.6, .8, 0))).toBeLessThan(.0001);
    visuals.positionLink(object, { start: { x: 1, y: 2, z: 3 }, end: { x: 1, y: 2, z: 3 } });
    expect(object.visible).toBe(false);
    expect(object.quaternion.toArray().every(Number.isFinite)).toBe(true);
    visuals.dispose();
  });

  it("retains topology and cached meshes across selection changes while keeping three visible edge layers", () => {
    const graph = createDisplayGraph(failchainScenario);
    const before = structuredClone(graph);
    const state = initializeSimulation(failchainScenario);
    const visuals = createCinematicRenderer(graph);
    const link = graph.links[0]!;
    const object = visuals.linkObject(link);
    const mesh = core(object);
    const halo = object.children[0], middle = object.children[2];
    if (!(halo instanceof Mesh) || !(halo.material instanceof ShaderMaterial)
      || !(middle instanceof Mesh) || !(middle.material instanceof MeshBasicMaterial)) throw new Error("Missing edge layers");
    expect(object.children).toHaveLength(3);
    expect(halo.scale.x).toBeGreaterThan(middle.scale.x);
    expect(middle.scale.x).toBeGreaterThan(mesh.scale.x);
    visuals.update(state, null, false);
    Reflect.apply(mesh.onBeforeRender, mesh, []);
    expect(mesh.material.blending).toBe(AdditiveBlending);
    expect(halo.material.blending).toBe(AdditiveBlending);
    expect(mesh.material.color.getHexString()).toBe(UI_COLORS.brand.slice(1).toLowerCase());
    expect(middle.material.color.getHexString()).toBe(UI_COLORS.brand.slice(1).toLowerCase());
    visuals.update(state, "gateway", true);
    expect(mesh.material.blending).toBe(AdditiveBlending);
    expect(halo.material.blending).toBe(AdditiveBlending);
    expect(visuals.linkObject(link)).toBe(object);
    expect(graph).toEqual(before);
    visuals.dispose();
  });

  it("uses a command-accent orbit without replacing the selected service's actual status color", () => {
    const graph = createDisplayGraph(failchainScenario);
    const visuals = createCinematicRenderer(graph);
    const state = initializeSimulation(failchainScenario);
    const before = structuredClone(state);
    const object = visuals.nodeObject(graph.nodes.find(({ id }) => id === "identity")!);
    const sphere = object.children[0];
    const orbit = object.children[2];
    if (!(sphere instanceof Mesh) || !(sphere.material instanceof MeshBasicMaterial)
      || !(orbit instanceof Mesh) || !(orbit.material instanceof MeshBasicMaterial)) throw new Error("Missing node visuals");
    visuals.update(state, "identity", false);
    Reflect.apply(sphere.onBeforeRender, sphere, []);
    expect(sphere.material.color.getHexString()).toBe(UI_COLORS.healthy.slice(1).toLowerCase());
    expect(orbit.material.color.getHexString()).toBe(UI_COLORS.selection.slice(1).toLowerCase());
    expect(orbit.visible).toBe(true);
    expect(visuals.nodeObject(graph.nodes.find(({ id }) => id === "identity")!)).toBe(object);
    expect(state).toEqual(before);
    visuals.dispose();
  });

  it("uses genuine overload and restart states for amber and violet connections", () => {
    const graph = createDisplayGraph(failchainScenario);
    const visuals = createCinematicRenderer(graph);
    let state = step(failchainScenario, initializeSimulation(failchainScenario), { type: "fail", serviceId: "gateway-a" });
    expect(state.services["gateway-b"]!.status).toBe("degraded");
    const b = core(visuals.linkObject(graph.links.find(({ providerId, kind }) => kind === "pool-member" && providerId === "gateway-b")!));
    visuals.update(state, null, false);
    Reflect.apply(b.onBeforeRender, b, []);
    expect(b.material.color.getHexString()).toBe(UI_COLORS.degraded.slice(1).toLowerCase());
    state = step(failchainScenario, state, { type: "repair", serviceId: "gateway-a" });
    expect(state.services["gateway-a"]!.status).toBe("recovering");
    const a = core(visuals.linkObject(graph.links.find(({ providerId, kind }) => kind === "pool-member" && providerId === "gateway-a")!));
    visuals.update(state, null, false);
    Reflect.apply(a.onBeforeRender, a, []);
    expect(a.material.color.getHexString()).toBe(UI_COLORS.recovering.slice(1).toLowerCase());
    visuals.dispose();
  });

  it("caches curved routing lanes for real dependencies and disposes them", () => {
    const graph = createDisplayGraph(failchainScenario);
    const visuals = createCinematicRenderer(graph);
    const link = graph.links.find(({ consumerId, providerId }) => consumerId === "gateway-b" && providerId === "identity")!;
    const a = graph.nodes.find(({ id }) => id === link.consumerId)!;
    const b = graph.nodes.find(({ id }) => id === link.providerId)!;
    const coords = { start: { x: a.x!, y: a.y!, z: a.z! }, end: { x: b.x!, y: b.y!, z: b.z! } };
    const object = visuals.linkObject(link);
    visuals.positionLink(object, coords);
    const mesh = core(object);
    const geometry = mesh.geometry;
    expect(geometry).toBeInstanceOf(TubeGeometry);
    const halo = object.children[0] as Mesh<TubeGeometry, ShaderMaterial>;
    expect(halo.material.uniforms.uCurved!.value).toBe(1);
    const dispose = vi.spyOn(geometry, "dispose");
    visuals.positionLink(object, coords);
    expect(mesh.geometry).toBe(geometry);
    visuals.update(step(failchainScenario, initializeSimulation(failchainScenario), { type: "fail", serviceId: "identity" }), null, false);
    expect(mesh.geometry).toBe(geometry);
    visuals.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("disables shader flow for reduced motion and disposes its shared GPU resources", () => {
    const graph = createDisplayGraph(failchainScenario);
    const visuals = createCinematicRenderer(graph);
    const object = visuals.linkObject(graph.links[0]!);
    const mesh = core(object);
    const halo = object.children[0];
    if (!(halo instanceof Mesh) || !(halo.material instanceof ShaderMaterial)) throw new Error("Missing halo");
    const disposeCore = vi.spyOn(mesh.material, "dispose");
    const disposeHalo = vi.spyOn(halo.material, "dispose");
    const disposeGeometry = vi.spyOn(mesh.geometry, "dispose");
    const state = initializeSimulation(failchainScenario);
    visuals.update(state, null, true);
    Reflect.apply(mesh.onBeforeRender, mesh, []);
    expect(halo.material.uniforms.uMotion!.value).toBe(1);
    visuals.update(state, null, false);
    Reflect.apply(mesh.onBeforeRender, mesh, []);
    expect(halo.material.uniforms.uMotion!.value).toBe(0);
    expect(halo.material.uniforms.uTime!.value).toBe(0);
    expect(halo.material.uniforms.uCurved!.value).toBe(0);
    visuals.dispose();
    expect(disposeCore).toHaveBeenCalledOnce();
    expect(disposeHalo).toHaveBeenCalledOnce();
    expect(disposeGeometry).toHaveBeenCalledOnce();
  });

  it("reserves stronger command lighting for actual provider incidents and focused circuits", () => {
    const graph = createDisplayGraph(failchainScenario);
    const visuals = createCinematicRenderer(graph);
    const link = graph.links.find(({ consumerId, providerId }) => consumerId === "gateway" && providerId === "identity")!;
    const object = visuals.linkObject(link);
    const halo = object.children[0] as Mesh<TubeGeometry, ShaderMaterial>;
    const middle = object.children[2] as Mesh<TubeGeometry, MeshBasicMaterial>;
    const initial = initializeSimulation(failchainScenario);
    visuals.update(initial, null, false);
    const healthyHalo = halo.material.uniforms.uOpacity!.value as number;
    expect(halo.material.uniforms.uGain!.value).toBeGreaterThan(1);
    const healthyMiddle = middle.material.opacity;
    const failed = step(failchainScenario, initial, { type: "fail", serviceId: "identity" });
    visuals.update(failed, null, false);
    expect(halo.material.uniforms.uOpacity!.value).toBeGreaterThan(healthyHalo);
    expect(middle.material.opacity).toBeGreaterThan(healthyMiddle);
    expect(failed.services.gateway!.status).toBe("healthy");
    visuals.update(initial, "gateway", false);
    expect(halo.material.uniforms.uOpacity!.value).toBeGreaterThan(healthyHalo);
    expect(visuals.linkObject(link)).toBe(object);
    visuals.dispose();
  });

  it("keeps selected reticles readable at different zoom levels and clears them on deselection", () => {
    const graph = createDisplayGraph(failchainScenario);
    const visuals = createCinematicRenderer(graph);
    const node = graph.nodes.find(({ id }) => id === "identity")!;
    const object = visuals.nodeObject(node);
    object.position.set(node.x!, node.y!, node.z!);
    const mesh = object.children[0] as Mesh;
    const orbit = object.children[2] as Mesh;
    const halo = object.children[3] as Mesh;
    const arc = object.children[4] as Mesh;
    const brackets = object.children[5] as LineSegments;
    const disposeGeometry = vi.spyOn(brackets.geometry, "dispose");
    const state = initializeSimulation(failchainScenario);
    const camera = new PerspectiveCamera(50, 1100 / 600, .1, 10000);
    const surface = { getSize: (target: Vector2) => target.set(1100, 600) };
    visuals.update(state, "identity", false);
    for (const distance of [1200, 2400]) {
      camera.position.set(0, 0, distance); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      Reflect.apply(mesh.onBeforeRender, mesh, [surface, null, camera]);
      object.updateMatrixWorld(true);
      const left = brackets.localToWorld(new Vector3(-60, 48, 0)).project(camera);
      const right = brackets.localToWorld(new Vector3(60, 48, 0)).project(camera);
      expect((right.x - left.x) * 550).toBeCloseTo(120, 5);
      expect(brackets.visible).toBe(true); expect(halo.visible).toBe(true); expect(arc.visible).toBe(true);
    }
    visuals.update(state, null, false);
    Reflect.apply(mesh.onBeforeRender, mesh, []);
    expect(brackets.visible).toBe(false); expect(halo.visible).toBe(false); expect(arc.visible).toBe(false);
    expect(orbit.visible).toBe(false);
    expect(visuals.nodeObject(node)).toBe(object);
    visuals.dispose();
    expect(disposeGeometry).toHaveBeenCalledOnce();
  });

  it("dims unrelated healthy circuits without predicting delayed failures", () => {
    const graph = createDisplayGraph(failchainScenario);
    const visuals = createCinematicRenderer(graph);
    const route = graph.links.find(({ consumerId, providerId }) => consumerId === "calendar" && providerId === "gateway")!;
    const object = visuals.linkObject(route);
    const mesh = core(object);
    const halo = object.children[0] as Mesh<TubeGeometry, ShaderMaterial>;
    const state = step(failchainScenario, initializeSimulation(failchainScenario), { type: "fail", serviceId: "identity" });
    const copy = structuredClone(state);
    visuals.update(state, null, false);
    Reflect.apply(mesh.onBeforeRender, mesh, []);
    expect(mesh.material.opacity).toBeLessThan(1);
    expect(mesh.material.color.getHexString()).toBe(UI_COLORS.brand.slice(1).toLowerCase());
    visuals.update(initializeSimulation(failchainScenario), null, false);
    expect(mesh.material.opacity).toBe(1);
    expect(halo.material.uniforms.uGain!.value).toBe(1.7);
    expect(halo.material.uniforms.uOpacity!.value).toBe(.4);
    expect(state).toEqual(copy);
    visuals.dispose();
  });

  it("keeps badge positions attached to their real anchors instead of repacking a grid", () => {
    const labels = [{ id: "a", x: 250, y: 180, width: 128, height: 60 }, { id: "b", x: 280, y: 180, width: 128, height: 60 }];
    const placed = placeGraphLabels(labels, 1000, 600, "b");
    expect(placed).toEqual([{ id: "a", left: 186, top: 150 }, { id: "b", left: 216, top: 150 }]);
    expect(placeGraphLabels(labels, 1000, 600, "a")).toEqual(placed);
  });
});
