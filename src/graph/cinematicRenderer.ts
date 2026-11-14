import {
  AdditiveBlending, BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh,
  MeshBasicMaterial, PerspectiveCamera, RingGeometry, ShaderMaterial, SphereGeometry, TubeGeometry, Vector2, Vector3,
} from "three";
import type { Object3D } from "three";
import type { GraphLink, GraphNode, ServiceGraphData } from "./toGraphData";
import type { SimulationState } from "../simulation/types";
import { UI_COLORS } from "../theme";
import { dependencyCurve, linkCurvature } from "./edgeRouting";

const vertexShader = `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec2 vUv;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-viewPosition.xyz);
    vUv = uv;
    gl_Position = projectionMatrix * viewPosition;
  }
`;
const fragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uMotion;
  uniform float uCurved;
  uniform float uGain;
  uniform float uFlowSpeed;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec2 vUv;
  void main() {
    float softness = pow(abs(dot(normalize(vNormal), normalize(vView))), 2.4);
    // Tube UV.x follows the route; cylinder UV.y follows its length.
    float alongPath = mix(vUv.y, vUv.x, uCurved);
    float flow = pow(max(0.0, sin(alongPath * 32.0 - uTime * uFlowSpeed)), 14.0);
    gl_FragColor = vec4(uColor * uGain * (1.0 + flow * uMotion * 0.4), softness * uOpacity);
    #include <colorspace_fragment>
  }
`;
const orbitFragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float radius = length(vUv - vec2(0.5)) * 2.0;
    float band = smoothstep(0.63, 0.8, radius) * (1.0 - smoothstep(0.8, 1.0, radius));
    gl_FragColor = vec4(uColor, band * uOpacity);
    #include <colorspace_fragment>
  }
`;

interface LinkVisual { group: Group; core: MeshBasicMaterial; middle: MeshBasicMaterial; halo: ShaderMaterial; target: Color; lastTime: number }
interface NodeVisual { group: Group; core: MeshBasicMaterial; ring: MeshBasicMaterial; orbit: Mesh; halo: Mesh<RingGeometry, ShaderMaterial>; arc: Mesh<RingGeometry, MeshBasicMaterial>; brackets: LineSegments<BufferGeometry, LineBasicMaterial>; target: Color; lastTime: number; selected: boolean; active: boolean }

/** Owned Three.js resources, reused for the lifetime of one fixed topology. */
export function createCinematicRenderer(graph: ServiceGraphData) {
  const cylinder = new CylinderGeometry(1, 1, 1, 12, 1, true);
  const sphere = new SphereGeometry(7, 20, 12);
  const ring = new RingGeometry(12, 13.2, 48);
  const orbit = new RingGeometry(35, 36, 64);
  const orbitHalo = new RingGeometry(30, 47, 64);
  const orbitArc = new RingGeometry(36, 37, 64, 1, 0, Math.PI * 1.55);
  const brackets = new BufferGeometry();
  const corners: number[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    corners.push(x * 60, y * 48, 0, x * 50, y * 48, 0, x * 60, y * 48, 0, x * 60, y * 38, 0);
  }
  brackets.setAttribute("position", new Float32BufferAttribute(corners, 3));
  const viewport = new Vector2();
  const worldPosition = new Vector3();
  const up = new Vector3(0, 1, 0);
  const direction = new Vector3();
  const links = new Map<GraphLink, LinkVisual>();
  const nodes = new Map<string, NodeVisual>();
  const routeLinks = new Map<Object3D, GraphLink>();
  const routeKeys = new Map<Object3D, string>();
  const routedGeometries = new Set<TubeGeometry>();
  let motion = false;
  const palette = UI_COLORS;

  const unlit = (color: string, opacity = 1) => new MeshBasicMaterial({ color, transparent: true, opacity,
    blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide });

  for (const link of graph.links) {
    const group = new Group();
    const core = unlit(UI_COLORS.brand);
    const middle = unlit(UI_COLORS.brand, .55);
    const halo = new ShaderMaterial({ vertexShader, fragmentShader, transparent: true,
      blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide,
      uniforms: { uColor: { value: new Color(UI_COLORS.brand) }, uOpacity: { value: .28 },
        uTime: { value: 0 }, uMotion: { value: 0 }, uCurved: { value: 0 }, uGain: { value: 1.7 }, uFlowSpeed: { value: 2.1 } } });
    const coreMesh = new Mesh(cylinder, core);
    coreMesh.scale.set(.85, 1, .85);
    coreMesh.renderOrder = 3;
    const middleMesh = new Mesh(cylinder, middle);
    middleMesh.scale.set(2.4, 1, 2.4);
    middleMesh.renderOrder = 2;
    const haloMesh = new Mesh(cylinder, halo);
    haloMesh.scale.set(6, 1, 6);
    haloMesh.renderOrder = 1;
    group.add(haloMesh, coreMesh, middleMesh);
    const visual = { group, core, middle, halo, target: new Color(UI_COLORS.brand), lastTime: 0 };
    coreMesh.onBeforeRender = () => {
      const now = performance.now() / 1000;
      const blend = motion ? 1 - Math.exp(-Math.min(.1, now - visual.lastTime) * 9) : 1;
      visual.lastTime = now;
      core.color.lerp(visual.target, blend);
      middle.color.copy(core.color);
      (halo.uniforms.uColor!.value as Color).copy(core.color);
      halo.uniforms.uTime!.value = motion ? now : 0;
      halo.uniforms.uMotion!.value = motion ? 1 : 0;
    };
    links.set(link, visual);
    routeLinks.set(group, link);
  }

  for (const node of graph.nodes) {
    const group = new Group();
    const core = unlit(UI_COLORS.healthy);
    const ringMaterial = unlit(UI_COLORS.healthy, .55);
    const coreMesh = new Mesh(sphere, core);
    coreMesh.position.y = 20;
    const ringMesh = new Mesh(ring, ringMaterial);
    ringMesh.position.y = 20;
    const orbitMesh = new Mesh(orbit, unlit(UI_COLORS.healthy, .5));
    orbitMesh.position.y = -41;
    orbitMesh.scale.set(55 / 35, 8 / 35, 1);
    const haloMesh = new Mesh(orbitHalo, new ShaderMaterial({ vertexShader, fragmentShader: orbitFragmentShader,
      transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide,
      uniforms: { uColor: { value: new Color(UI_COLORS.healthy) }, uOpacity: { value: .5 } } }));
    const arcMesh = new Mesh(orbitArc, unlit(UI_COLORS.selection, .7));
    const bracketLines = new LineSegments(brackets, new LineBasicMaterial({ color: UI_COLORS.selection,
      transparent: true, opacity: .85, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    bracketLines.renderOrder = 6;
    haloMesh.visible = arcMesh.visible = bracketLines.visible = false;
    group.add(coreMesh, ringMesh, orbitMesh, haloMesh, arcMesh, bracketLines);
    const visual = { group, core, ring: ringMaterial, orbit: orbitMesh, halo: haloMesh, arc: arcMesh, brackets: bracketLines, target: new Color(UI_COLORS.healthy), lastTime: 0, selected: false, active: false };
    coreMesh.onBeforeRender = (renderer, _scene, camera) => {
      const now = performance.now() / 1000;
      const blend = motion ? 1 - Math.exp(-Math.min(.1, now - visual.lastTime) * 9) : 1;
      visual.lastTime = now;
      core.color.lerp(visual.target, blend);
      ringMaterial.color.copy(core.color);
      (orbitMesh.material as MeshBasicMaterial).color.set(visual.selected ? palette.selection : core.color);
      ringMaterial.opacity = motion ? visual.active ? .55 + .15 * Math.sin(now * 2) : .32 + .04 * Math.sin(now * 1.3) : visual.active ? .6 : .36;
      orbitMesh.visible = visual.selected || visual.active;
      const pulse = motion && (visual.active || visual.selected) ? 1 + .04 * Math.sin(now * 1.7) : 1;
      // Size the under-card orbit and selection brackets in CSS pixels, like the readable labels.
      // Fixed world radii otherwise disappear behind opaque labels in the fitted overview.
      let units = 1;
      if (camera instanceof PerspectiveCamera && renderer) {
        renderer.getSize(viewport);
        group.getWorldPosition(worldPosition).applyMatrix4(camera.matrixWorldInverse);
        units = 2 * Math.tan(camera.fov * Math.PI / 360) * Math.max(.01, -worldPosition.z) / Math.max(1, viewport.y);
      }
      orbitMesh.position.y = -41 * units;
      orbitMesh.scale.set(55 / 35 * units * pulse, 8 / 35 * units * pulse, 1);
      haloMesh.position.copy(orbitMesh.position);
      haloMesh.scale.set(59 / 47 * units * pulse, 12 / 47 * units * pulse, 1);
      (haloMesh.material.uniforms.uColor!.value as Color).copy(core.color);
      haloMesh.material.uniforms.uOpacity!.value = visual.active ? .8 : .45;
      arcMesh.position.copy(orbitMesh.position);
      arcMesh.scale.set(58 / 37 * units, 11 / 37 * units, 1);
      // A restrained signal pulse keeps the ellipse aligned with the readable card.
      arcMesh.material.opacity = motion ? .65 + .12 * Math.sin(now * 1.4) : .7;
      arcMesh.material.color.set(visual.selected ? palette.selection : core.color);
      bracketLines.scale.setScalar(units);
      bracketLines.material.color.set(palette.selection);
      // These transforms are set after the scene's matrix pass; publish them for this frame.
      orbitMesh.updateMatrixWorld(true); haloMesh.updateMatrixWorld(true);
      arcMesh.updateMatrixWorld(true); bracketLines.updateMatrixWorld(true);
    };
    nodes.set(node.id, visual);
  }

  return {
    linkObject: (link: GraphLink) => links.get(link)!.group,
    nodeObject: (node: GraphNode) => nodes.get(node.id)!.group,
    positionLink: (object: Object3D, coords: { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }) => {
      const link = routeLinks.get(object);
      if (link && linkCurvature(link)) {
        links.get(link)!.halo.uniforms.uCurved!.value = 1;
        const key = JSON.stringify(coords);
        if (routeKeys.get(object) !== key) {
          const curve = dependencyCurve(link, new Vector3(coords.start.x, coords.start.y, coords.start.z), new Vector3(coords.end.x, coords.end.y, coords.end.z));
          object.children.forEach((child, index) => {
            const mesh = child as Mesh;
            if (mesh.geometry instanceof TubeGeometry) { mesh.geometry.dispose(); routedGeometries.delete(mesh.geometry); }
            const geometry = new TubeGeometry(curve, 32, [6, .85, 2.4][index]!, 8, false);
            routedGeometries.add(geometry); mesh.geometry = geometry; mesh.scale.set(1, 1, 1);
          });
          routeKeys.set(object, key);
        }
        object.position.set(0, 0, 0); object.quaternion.identity(); object.scale.set(1, 1, 1);
        return true;
      }
      direction.set(coords.end.x - coords.start.x, coords.end.y - coords.start.y, coords.end.z - coords.start.z);
      const length = direction.length();
      object.visible = length > .001;
      if (length > .001) {
        object.position.set((coords.start.x + coords.end.x) / 2, (coords.start.y + coords.end.y) / 2, (coords.start.z + coords.end.z) / 2);
        object.quaternion.setFromUnitVectors(up, direction.multiplyScalar(1 / length));
        object.scale.set(1, length, 1);
      }
      return true;
    },
    update(state: SimulationState, selectedId: string | null, animate: boolean, focusId: string | null = selectedId) {
      motion = animate;
      const hasIncident = Object.values(state.services).some(({ status }) => status !== "healthy");
      for (const [link, visual] of links) {
        const provider = state.services[link.providerId]!.status;
        // Provider health describes this dependency; the consumer may fail a tick later.
        const color = provider === "healthy" ? palette[link.kind === "pool-member" ? "link-pool" : link.kind === "optional" ? "link-optional" : "link-required"] : palette[provider];
        visual.target.set(color);
        const related = link.consumerId === focusId || link.providerId === focusId;
        const incident = provider !== "healthy";
        visual.core.opacity = hasIncident && !incident && !related ? .55 : link.kind === "optional" ? .65 : focusId && !related && !incident ? .65 : 1;
        // Incident intensity follows confirmed provider state, never forecasts or guessed cascades.
        visual.middle.opacity = incident ? .95 : related ? .85 : hasIncident ? .32 : .68;
        visual.halo.uniforms.uOpacity!.value = incident ? .64 : related ? .55 : hasIncident ? .18 : link.kind === "optional" ? .25 : .4;
      }
      for (const [id, visual] of nodes) {
        const status = state.services[id]!.status;
        visual.target.set(palette[status]);
        visual.selected = selectedId === id;
        visual.active = status === "offline" || status === "recovering" || status === "degraded";
        visual.halo.visible = visual.active || visual.selected;
        visual.arc.visible = visual.active || visual.selected;
        visual.brackets.visible = visual.selected;
      }
    },
    dispose() {
      for (const visual of links.values()) { visual.core.dispose(); visual.middle.dispose(); visual.halo.dispose(); }
      for (const visual of nodes.values()) { visual.core.dispose(); visual.ring.dispose(); (visual.orbit.material as MeshBasicMaterial).dispose(); visual.halo.material.dispose(); visual.arc.material.dispose(); visual.brackets.material.dispose(); }
      cylinder.dispose(); sphere.dispose(); ring.dispose(); orbit.dispose(); orbitHalo.dispose(); orbitArc.dispose(); brackets.dispose();
      for (const geometry of routedGeometries) geometry.dispose();
    },
  };
}
