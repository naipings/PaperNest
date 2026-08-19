import { useEffect, useRef, useState, type PointerEventHandler, type WheelEventHandler } from "react";

export type GraphCamera = { centerX: number; centerY: number; zoom: number };
type GraphWorld = { width: number; height: number };
type DragState = { pointerId: number; clientX: number; clientY: number; camera: GraphCamera } | undefined;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function graphViewBox(camera: GraphCamera, world: GraphWorld) {
  const width = world.width / camera.zoom;
  const height = world.height / camera.zoom;
  return [camera.centerX - width / 2, camera.centerY - height / 2, width, height].join(" ");
}

export function useGraphViewport({
  world,
  minZoom = .65,
  maxZoom = 2.2,
  onBlankClick,
}: {
  world: GraphWorld;
  minZoom?: number;
  maxZoom?: number;
  onBlankClick?(): void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState>(undefined);
  const movedRef = useRef(false);
  const home = () => ({ centerX: world.width / 2, centerY: world.height / 2, zoom: 1 });
  const [camera, setCamera] = useState<GraphCamera>(home);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    setCamera(home());
  }, [world.width, world.height]);

  const zoomAt = (clientX: number, clientY: number, requestedZoom: number) => {
    const nextZoom = clamp(requestedZoom, minZoom, maxZoom);
    const svg = svgRef.current;
    if (!svg) { setCamera(current => ({ ...current, zoom: nextZoom })); return; }
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const oldWidth = world.width / camera.zoom;
    const oldHeight = world.height / camera.zoom;
    const ratioX = (clientX - rect.left) / rect.width;
    const ratioY = (clientY - rect.top) / rect.height;
    const anchorX = camera.centerX - oldWidth / 2 + ratioX * oldWidth;
    const anchorY = camera.centerY - oldHeight / 2 + ratioY * oldHeight;
    const nextWidth = world.width / nextZoom;
    const nextHeight = world.height / nextZoom;
    setCamera({ zoom: nextZoom, centerX: anchorX - ratioX * nextWidth + nextWidth / 2, centerY: anchorY - ratioY * nextHeight + nextHeight / 2 });
  };

  const onWheel: WheelEventHandler<SVGSVGElement> = event => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, camera.zoom + (event.deltaY < 0 ? .12 : -.12));
  };
  const onPointerDown: PointerEventHandler<SVGSVGElement> = event => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest(".knowledge-map-node"))) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    movedRef.current = false;
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, camera };
    setPanning(true);
  };
  const onPointerMove: PointerEventHandler<SVGSVGElement> = event => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 4) movedRef.current = true;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const visibleWidth = world.width / drag.camera.zoom;
    const visibleHeight = world.height / drag.camera.zoom;
    setCamera({ ...drag.camera, centerX: drag.camera.centerX - (event.clientX - drag.clientX) * visibleWidth / rect.width, centerY: drag.camera.centerY - (event.clientY - drag.clientY) * visibleHeight / rect.height });
  };
  const endPan: PointerEventHandler<SVGSVGElement> = event => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const wasClick = !movedRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = undefined;
    setPanning(false);
    if (wasClick) onBlankClick?.();
  };
  const zoomBy = (amount: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    zoomAt(rect ? rect.left + rect.width / 2 : 0, rect ? rect.top + rect.height / 2 : 0, camera.zoom + amount);
  };
  const reset = () => setCamera(home());

  return { camera, panning, zoomBy, reset, svgProps: { ref: svgRef, viewBox: graphViewBox(camera, world), onWheel, onPointerDown, onPointerMove, onPointerUp: endPan, onPointerCancel: endPan } };
}
