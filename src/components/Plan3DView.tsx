import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoxGeometry, CylinderGeometry, PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LayoutWarning } from "../editor/analysis/layout-analysis";
import { buildSceneModel } from "../editor/geometry3d/scene-model";
import type { ProjectState, SelectionState } from "../editor/model/types";

type CameraPreset = "isometric" | "top" | "entrance" | "selection";

interface Plan3DViewProps {
  project: ProjectState;
  selection: SelectionState;
  selectedWallId: string | null;
  layoutWarnings: LayoutWarning[];
  onObjectSelect: (objectId: string, additive: boolean) => void;
  onWallSelect: (wallId: string, sourceObjectId?: string) => void;
  onClearSelection: () => void;
}

interface CameraTarget {
  x: number;
  y: number;
  z: number;
}

function CameraController({
  preset,
  target,
  spanM,
}: {
  preset: CameraPreset;
  target: CameraTarget;
  spanM: number;
}) {
  const { camera, gl, invalidate } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.minDistance = 1;
    controls.maxDistance = Math.max(100, spanM * 4);
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    const handleChange = () => invalidate();
    controls.addEventListener("change", handleChange);
    controlsRef.current = controls;
    return () => {
      controls.removeEventListener("change", handleChange);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl.domElement, invalidate, spanM]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const distance = Math.max(8, spanM * 0.72);
    if (preset === "top") {
      camera.position.set(target.x, Math.max(14, spanM * 1.05), target.z + 0.01);
    } else if (preset === "entrance") {
      camera.position.set(target.x - distance, Math.max(3.5, spanM * 0.09), target.z + spanM * 0.08);
    } else if (preset === "selection") {
      camera.position.set(target.x + Math.min(8, distance), target.y + Math.min(6, distance * 0.5), target.z + Math.min(8, distance));
    } else {
      camera.position.set(target.x + distance, Math.max(10, distance * 0.55), target.z + distance * 0.62);
    }
    controls.target.set(target.x, target.y, target.z);
    camera.lookAt(new Vector3(target.x, target.y, target.z));
    camera.updateProjectionMatrix();
    controls.update();
    invalidate();
  }, [camera, invalidate, preset, spanM, target.x, target.y, target.z]);

  return null;
}

function Scene({
  project,
  selection,
  selectedWallId,
  layoutWarnings,
  showWalls,
  showCeiling,
  cutawayHeightM,
  preset,
  onObjectSelect,
  onWallSelect,
  onClearSelection,
}: Plan3DViewProps & {
  showWalls: boolean;
  showCeiling: boolean;
  cutawayHeightM: number;
  preset: CameraPreset;
}) {
  const scene = useMemo(
    () => buildSceneModel(project, layoutWarnings),
    [layoutWarnings, project],
  );
  const boxGeometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  const cylinderGeometry = useMemo(() => new CylinderGeometry(0.5, 0.5, 1, 32), []);
  const selectedIds = useMemo(() => new Set(selection.objectIds), [selection.objectIds]);
  const wallById = useMemo(() => new Map(scene.walls.map((wall) => [wall.id, wall])), [scene.walls]);
  const selectedObject = project.objects.find((object) => selectedIds.has(object.id));
  const selectedWall = selectedWallId ? wallById.get(selectedWallId) : undefined;
  const target = selectedObject
    ? { x: selectedObject.xM, y: selectedObject.elevationM + selectedObject.heightM / 2, z: selectedObject.yM }
    : selectedWall
      ? {
          x: (selectedWall.start.xM + selectedWall.end.xM) / 2,
          y: selectedWall.baseElevationM + selectedWall.heightM / 2,
          z: (selectedWall.start.yM + selectedWall.end.yM) / 2,
        }
      : { x: scene.centerXM, y: 0, z: scene.centerZM };

  useEffect(() => () => {
    boxGeometry.dispose();
    cylinderGeometry.dispose();
  }, [boxGeometry, cylinderGeometry]);

  return (
    <>
      <color attach="background" args={["#edf2f0"]} />
      <ambientLight intensity={1.1} />
      <directionalLight position={[scene.centerXM - 12, 18, scene.centerZM + 8]} intensity={1.5} />
      <CameraController
        preset={preset}
        target={preset === "selection" ? target : { x: scene.centerXM, y: 0, z: scene.centerZM }}
        spanM={Math.max(scene.widthM, scene.depthM)}
      />

      <mesh
        geometry={boxGeometry}
        position={[scene.centerXM, -0.06, scene.centerZM]}
        scale={[scene.widthM, 0.12, scene.depthM]}
        receiveShadow
        onPointerDown={(event) => { event.stopPropagation(); onClearSelection(); }}
      >
        <meshStandardMaterial color="#d8dedb" />
      </mesh>

      {showCeiling ? (
        <mesh
          geometry={boxGeometry}
          position={[scene.centerXM, scene.ceilingHeightM + 0.04, scene.centerZM]}
          scale={[scene.widthM, 0.08, scene.depthM]}
        >
          <meshStandardMaterial color="#ffffff" transparent opacity={0.24} depthWrite={false} />
        </mesh>
      ) : null}

      {showWalls ? scene.wallSolids.map((solid) => {
        const bottomM = solid.centerYM - solid.heightM / 2;
        const topM = Math.min(solid.centerYM + solid.heightM / 2, cutawayHeightM);
        const visibleHeightM = topM - bottomM;
        if (visibleHeightM <= 0.001) return null;
        const wall = wallById.get(solid.wallId);
        return (
          <mesh
            key={solid.id}
            geometry={boxGeometry}
            position={[solid.centerXM, bottomM + visibleHeightM / 2, solid.centerZM]}
            rotation={[0, solid.rotationYRad, 0]}
            scale={[solid.lengthM, visibleHeightM, solid.depthM]}
            onPointerDown={(event) => {
              event.stopPropagation();
              onWallSelect(solid.wallId, wall?.sourceObjectId);
            }}
          >
            <meshStandardMaterial
              color={solid.wallId === selectedWallId ? "#df8f4f" : solid.kind === "partition" ? "#879490" : "#f6f2e9"}
              roughness={0.88}
            />
          </mesh>
        );
      }) : null}

      {scene.openings.map((opening) => (
        <mesh
          key={opening.id}
          geometry={boxGeometry}
          position={[opening.centerXM, opening.centerYM, opening.centerZM]}
          rotation={[0, opening.rotationYRad, 0]}
          scale={[opening.widthM, opening.heightM, opening.depthM]}
          onPointerDown={(event) => {
            event.stopPropagation();
            if (opening.sourceObjectId) onObjectSelect(opening.sourceObjectId, event.nativeEvent.shiftKey);
          }}
        >
          <meshStandardMaterial
            color={opening.kind === "window" ? "#7bc5db" : "#a9794f"}
            transparent={opening.kind === "window"}
            opacity={opening.kind === "window" ? 0.42 : 1}
          />
        </mesh>
      ))}

      {scene.objects.map((object) => {
        const selected = selectedIds.has(object.id);
        return (
          <mesh
            key={object.id}
            geometry={object.shape === "box" ? boxGeometry : cylinderGeometry}
            position={[object.centerXM, object.centerYM, object.centerZM]}
            rotation={[0, object.rotationYRad, 0]}
            scale={[object.widthM, object.heightM, object.depthM]}
            onPointerDown={(event) => {
              event.stopPropagation();
              onObjectSelect(object.id, event.nativeEvent.shiftKey);
            }}
          >
            <meshStandardMaterial
              color={object.warning ? "#d65a4a" : selected ? "#e6a04d" : object.color}
              emissive={selected ? "#4d2f08" : "#000000"}
              emissiveIntensity={selected ? 0.22 : 0}
              transparent={object.kind === "zone"}
              opacity={object.kind === "zone" ? 0.42 : 1}
            />
          </mesh>
        );
      })}

      <gridHelper args={[Math.ceil(scene.widthM), Math.ceil(scene.widthM), "#a9b9b2", "#d2dad6"]} position={[scene.centerXM, 0.005, scene.centerZM]} />
    </>
  );
}

function supportsWebGL2(): boolean {
  if (typeof window === "undefined" || typeof WebGL2RenderingContext === "undefined") return false;
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

export function Plan3DView(props: Plan3DViewProps) {
  const [preset, setPreset] = useState<CameraPreset>("isometric");
  const [showWalls, setShowWalls] = useState(true);
  const [showCeiling, setShowCeiling] = useState(false);
  const [cutawayHeightM, setCutawayHeightM] = useState(props.project.architecture.defaultWallHeightM);
  const webglAvailable = useMemo(supportsWebGL2, []);

  useEffect(() => {
    setCutawayHeightM((current) => Math.min(current, props.project.architecture.defaultWallHeightM));
  }, [props.project.architecture.defaultWallHeightM]);

  if (!webglAvailable) {
    return (
      <div className="three-fallback" role="status">
        <strong>3D недоступно</strong>
        <span>WebGL 2 или аппаратное ускорение отключено. Двумерный редактор продолжает работать без ограничений.</span>
      </div>
    );
  }

  return (
    <section className="three-view" aria-label="Схематичная 3D-визуализация">
      <div className="three-toolbar">
        <div className="three-toolbar__group" aria-label="Камера">
          <button type="button" className={preset === "isometric" ? "is-active" : ""} onClick={() => setPreset("isometric")}>Изометрия</button>
          <button type="button" className={preset === "top" ? "is-active" : ""} onClick={() => setPreset("top")}>Сверху</button>
          <button type="button" className={preset === "entrance" ? "is-active" : ""} onClick={() => setPreset("entrance")}>От входа</button>
          <button type="button" className={preset === "selection" ? "is-active" : ""} onClick={() => setPreset("selection")} disabled={props.selection.objectIds.length === 0 && !props.selectedWallId}>К выбранному</button>
        </div>
        <label><input type="checkbox" checked={showWalls} onChange={(event) => setShowWalls(event.target.checked)} /> Стены</label>
        <label><input type="checkbox" checked={showCeiling} onChange={(event) => setShowCeiling(event.target.checked)} /> Потолок</label>
        <label className="three-cutaway">Сечение {cutawayHeightM.toFixed(2)} м<input type="range" min="0.5" max={Math.max(3.5, props.project.architecture.defaultWallHeightM)} step="0.01" value={cutawayHeightM} onChange={(event) => setCutawayHeightM(Number(event.target.value))} /></label>
      </div>
      <div className="three-canvas-wrap">
        <Canvas
          frameloop="demand"
          dpr={[1, 1.5]}
          camera={{ position: [10, 10, 10], fov: 45, near: 0.05, far: 500 }}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onPointerMissed={props.onClearSelection}
          onCreated={({ camera }) => {
            (camera as PerspectiveCamera).updateProjectionMatrix();
          }}
        >
          <Scene
            {...props}
            showWalls={showWalls}
            showCeiling={showCeiling}
            cutawayHeightM={cutawayHeightM}
            preset={preset}
          />
        </Canvas>
      </div>
      <div className="three-legend">
        <span><i className="legend-swatch legend-swatch--selected" />Выбрано</span>
        <span><i className="legend-swatch legend-swatch--warning" />Коллизия или проход</span>
        <span>ЛКМ — выбор · Shift+ЛКМ — добавить · колесо — масштаб · ПКМ — панорама</span>
      </div>
    </section>
  );
}
