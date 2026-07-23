import { Application, Graphics, Sprite } from "pixi.js";
import { drawSquircleOnGraphics } from "@/lib/geometry/squircle";
import { ADVANCED_VERTICAL_PADDING_MAX, type CropRegion, type Padding, type WebcamPositionPreset } from "../types";

export const PADDING_SCALE_FACTOR = 0.2;
export const BASE_PREVIEW_WIDTH = 1920;
export const BASE_PREVIEW_HEIGHT = 1080;

export function scalePreviewBorderRadius(width: number, height: number, borderRadius = 0): number {
	if (width <= 0 || height <= 0) {
		return 0;
	}

	const canvasScaleFactor = Math.min(width / BASE_PREVIEW_WIDTH, height / BASE_PREVIEW_HEIGHT);
	return Math.max(0, borderRadius * canvasScaleFactor);
}

export function isZeroPadding(padding: Padding | number): boolean {
	if (typeof padding === "number") {
		return padding === 0;
	}
	return padding.top === 0 && padding.bottom === 0 && padding.left === 0 && padding.right === 0;
}

export interface PaddedLayoutResult {
	scale: number;
	centerOffsetX: number;
	centerOffsetY: number;
	spriteX: number;
	spriteY: number;
	fullFrameDisplayW: number;
	fullFrameDisplayH: number;
	fullVideoDisplayWidth: number;
	fullVideoDisplayHeight: number;
	croppedDisplayWidth: number;
	croppedDisplayHeight: number;
	cropStartX: number;
	cropStartY: number;
}

export interface SplitLayoutInfo {
	camRect: { x: number; y: number; width: number; height: number };
	screenRect: { x: number; y: number; width: number; height: number; scale: number };
}

export function computeSplitLayout(params: {
	stageWidth: number;
	stageHeight: number;
	videoWidth: number;
	videoHeight: number;
	preset: "split-left" | "split-right";
}): SplitLayoutInfo {
	const { stageWidth, stageHeight, videoWidth, videoHeight, preset } = params;

	// Target height is 68% of stage height
	let hElement = stageHeight * 0.68;
	const wCamUnscaled = hElement * (3 / 4); // 3:4 portrait camera card
	const videoAspect = videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
	const wScreenUnscaled = hElement * videoAspect;

	// Total available width for elements is 88% of stage width (saving 12% for 3 equal gaps)
	const maxAvailWidth = stageWidth * 0.88;
	const sumUnscaledW = wCamUnscaled + wScreenUnscaled;

	let scaleFactor = 1;
	if (sumUnscaledW > maxAvailWidth) {
		scaleFactor = maxAvailWidth / sumUnscaledW;
	}

	hElement *= scaleFactor;
	const wCam = wCamUnscaled * scaleFactor;
	const wScreen = wScreenUnscaled * scaleFactor;

	const gap = (stageWidth - wCam - wScreen) / 3;
	const yPos = (stageHeight - hElement) / 2;

	let camX = 0;
	let screenX = 0;

	if (preset === "split-left") {
		camX = gap;
		screenX = gap + wCam + gap;
	} else {
		screenX = gap;
		camX = gap + wScreen + gap;
	}

	return {
		camRect: {
			x: Math.round(camX),
			y: Math.round(yPos),
			width: Math.round(wCam),
			height: Math.round(hElement),
		},
		screenRect: {
			x: Math.round(screenX),
			y: Math.round(yPos),
			width: Math.round(wScreen),
			height: Math.round(hElement),
			scale: videoWidth > 0 ? wScreen / videoWidth : 1,
		},
	};
}

export function computePaddedLayout(params: {
	width: number;
	height: number;
	padding: Padding | number;
	frameInsets?: { top: number; right: number; bottom: number; left: number } | null;
	cropRegion: CropRegion;
	videoWidth: number;
	videoHeight: number;
	webcamPositionPreset?: WebcamPositionPreset;
}): PaddedLayoutResult {
	const { width, height, padding, frameInsets, cropRegion, videoWidth, videoHeight, webcamPositionPreset } = params;

	if (webcamPositionPreset === "split-left" || webcamPositionPreset === "split-right") {
		const splitInfo = computeSplitLayout({
			stageWidth: width,
			stageHeight: height,
			videoWidth,
			videoHeight,
			preset: webcamPositionPreset,
		});

		const crop = cropRegion || { x: 0, y: 0, width: 1, height: 1 };
		const scale = splitInfo.screenRect.scale;
		const fullVideoDisplayWidth = videoWidth * scale;
		const fullVideoDisplayHeight = videoHeight * scale;
		const croppedDisplayWidth = splitInfo.screenRect.width;
		const croppedDisplayHeight = splitInfo.screenRect.height;
		const centerOffsetX = splitInfo.screenRect.x;
		const centerOffsetY = splitInfo.screenRect.y;

		const spriteX = centerOffsetX - crop.x * fullVideoDisplayWidth;
		const spriteY = centerOffsetY - crop.y * fullVideoDisplayHeight;

		return {
			scale,
			centerOffsetX,
			centerOffsetY,
			spriteX,
			spriteY,
			fullFrameDisplayW: croppedDisplayWidth,
			fullFrameDisplayH: croppedDisplayHeight,
			fullVideoDisplayWidth,
			fullVideoDisplayHeight,
			croppedDisplayWidth,
			croppedDisplayHeight,
			cropStartX: crop.x * videoWidth,
			cropStartY: crop.y * videoHeight,
		};
	}
	// Apply asymmetrical padding
	const p =
		typeof padding === "number"
			? { top: padding, bottom: padding, left: padding, right: padding }
			: padding;

	const isAdvancedPadding = typeof padding !== "number" && padding.linked === false;
	const clampPercent = (v: number, max = 100) => Math.min(max, Math.max(0, v));
	const leftPercent = clampPercent(p.left);
	const rightPercent = clampPercent(p.right);
	const topPercent = clampPercent(p.top, isAdvancedPadding ? ADVANCED_VERTICAL_PADDING_MAX : 100);
	const bottomPercent = clampPercent(
		p.bottom,
		isAdvancedPadding ? ADVANCED_VERTICAL_PADDING_MAX : 100,
	);
	const leftPadFrac = (leftPercent / 100) * PADDING_SCALE_FACTOR;
	const rightPadFrac = (rightPercent / 100) * PADDING_SCALE_FACTOR;
	const topPadFrac = (Math.min(topPercent, 100) / 100) * PADDING_SCALE_FACTOR;
	const bottomPadFrac = (Math.min(bottomPercent, 100) / 100) * PADDING_SCALE_FACTOR;

	const availableFracW = Math.max(0, 1.0 - leftPadFrac - rightPadFrac);
	const availableFracH = Math.max(0, 1.0 - topPadFrac - bottomPadFrac);

	const maxDisplayWidth = width * availableFracW;
	const maxDisplayHeight = height * availableFracH;

	const crop = cropRegion;
	const croppedVideoWidth = videoWidth * crop.width;
	const croppedVideoHeight = videoHeight * crop.height;

	const insets = frameInsets;
	const screenFracW = insets ? 1 - insets.left - insets.right : 1;
	const screenFracH = insets ? 1 - insets.top - insets.bottom : 1;

	const fullFrameVideoW = croppedVideoWidth / screenFracW;
	const fullFrameVideoH = croppedVideoHeight / screenFracH;

	const scale = Math.min(
		fullFrameVideoW > 0 ? maxDisplayWidth / fullFrameVideoW : 0,
		fullFrameVideoH > 0 ? maxDisplayHeight / fullFrameVideoH : 0,
	);

	const fullVideoDisplayWidth = videoWidth * scale;
	const fullVideoDisplayHeight = videoHeight * scale;
	const croppedDisplayWidth = croppedVideoWidth * scale;
	const croppedDisplayHeight = croppedVideoHeight * scale;

	const fullFrameDisplayW = fullFrameVideoW * scale;
	const fullFrameDisplayH = fullFrameVideoH * scale;

	const availableCenterX = leftPadFrac * width + maxDisplayWidth / 2;
	const availableCenterY = isAdvancedPadding
		? (() => {
				const verticalTravel = Math.max(0, height - fullFrameDisplayH);
				const centeredOffsetY = verticalTravel / 2;
				const directionalOffsetY =
					centeredOffsetY +
					((topPercent - bottomPercent) / ADVANCED_VERTICAL_PADDING_MAX) *
						centeredOffsetY;
				const frameOffsetY = Math.min(verticalTravel, Math.max(0, directionalOffsetY));
				return frameOffsetY + fullFrameDisplayH / 2;
			})()
		: topPadFrac * height + maxDisplayHeight / 2;

	const frameCenterX = availableCenterX - fullFrameDisplayW / 2;
	const frameCenterY = availableCenterY - fullFrameDisplayH / 2;

	const centerOffsetX = insets ? frameCenterX + insets.left * fullFrameDisplayW : frameCenterX;
	const centerOffsetY = insets ? frameCenterY + insets.top * fullFrameDisplayH : frameCenterY;

	const spriteX = centerOffsetX - crop.x * fullVideoDisplayWidth;
	const spriteY = centerOffsetY - crop.y * fullVideoDisplayHeight;

	return {
		scale,
		centerOffsetX,
		centerOffsetY,
		spriteX,
		spriteY,
		fullFrameDisplayW,
		fullFrameDisplayH,
		fullVideoDisplayWidth,
		fullVideoDisplayHeight,
		croppedDisplayWidth,
		croppedDisplayHeight,
		cropStartX: crop.x * videoWidth,
		cropStartY: crop.y * videoHeight,
	};
}

interface LayoutParams {
	container: HTMLDivElement;
	app: Application;
	videoSprite: Sprite;
	maskGraphics: Graphics;
	videoElement: HTMLVideoElement;
	cropRegion?: CropRegion;
	lockedVideoDimensions?: { width: number; height: number } | null;
	borderRadius?: number;
	padding?: Padding | number;
	webcamPositionPreset?: WebcamPositionPreset;
	/** Screen insets from the active device frame, used to scale/center the full frame */
	frameInsets?: { top: number; right: number; bottom: number; left: number } | null;
}

interface LayoutResult {
	stageSize: { width: number; height: number };
	videoSize: { width: number; height: number };
	baseScale: number;
	baseOffset: { x: number; y: number };
	maskRect: {
		x: number;
		y: number;
		width: number;
		height: number;
		sourceCrop?: CropRegion;
	};
	cropBounds: { startX: number; endX: number; startY: number; endY: number };
}

export function layoutVideoContent(params: LayoutParams): LayoutResult | null {
	const {
		container,
		app,
		videoSprite,
		maskGraphics,
		videoElement,
		cropRegion,
		lockedVideoDimensions,
		borderRadius = 0,
		padding = 0,
		frameInsets,
		webcamPositionPreset,
	} = params;

	const videoWidth = lockedVideoDimensions?.width || videoElement.videoWidth;
	const videoHeight = lockedVideoDimensions?.height || videoElement.videoHeight;

	if (!videoWidth || !videoHeight) {
		return null;
	}

	const width = container.clientWidth;
	const height = container.clientHeight;

	if (!width || !height) {
		return null;
	}

	app.renderer.resize(width, height);
	app.canvas.style.width = "100%";
	app.canvas.style.height = "100%";

	const crop = cropRegion || { x: 0, y: 0, width: 1, height: 1 };
	const layout = computePaddedLayout({
		width,
		height,
		padding,
		frameInsets,
		cropRegion: crop,
		videoWidth,
		videoHeight,
		webcamPositionPreset,
	});

	videoSprite.scale.set(layout.scale);
	videoSprite.position.set(layout.spriteX, layout.spriteY);

	maskGraphics.clear();
	drawSquircleOnGraphics(maskGraphics, {
		x: layout.centerOffsetX,
		y: layout.centerOffsetY,
		width: layout.croppedDisplayWidth,
		height: layout.croppedDisplayHeight,
		radius: scalePreviewBorderRadius(width, height, borderRadius),
	});
	maskGraphics.fill({ color: 0xffffff });

	return {
		stageSize: { width, height },
		videoSize: { width: videoWidth * crop.width, height: videoHeight * crop.height },
		baseScale: layout.scale,
		baseOffset: { x: layout.spriteX, y: layout.spriteY },
		maskRect: {
			x: layout.centerOffsetX,
			y: layout.centerOffsetY,
			width: layout.croppedDisplayWidth,
			height: layout.croppedDisplayHeight,
			sourceCrop: crop,
		},
		cropBounds: {
			startX: layout.cropStartX,
			endX: layout.cropStartX + videoWidth * crop.width,
			startY: layout.cropStartY,
			endY: layout.cropStartY + videoHeight * crop.height,
		},
	};
}
