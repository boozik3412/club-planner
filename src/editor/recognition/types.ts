import type {
  ArchitectureVertex,
  ArchitecturalOpening,
  ArchitecturalWall,
  PlanSource,
  SourcePoint,
} from "../model/types";

export type RecognitionStage =
  | "preparing"
  | "vector"
  | "raster"
  | "ocr"
  | "graph"
  | "validating";

export interface RecognitionProgress {
  stage: RecognitionStage;
  progress: number;
  message: string;
}

export interface RecognitionOptions {
  detectWalls: boolean;
  detectOpenings: boolean;
  detectArcs: boolean;
  recognizeText: boolean;
  defaultWallHeightM: number;
  defaultWallThicknessM: number;
  joinToleranceM: number;
  minimumWallLengthM: number;
}

export interface RecognitionImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  cropQuad: [SourcePoint, SourcePoint, SourcePoint, SourcePoint];
  outputWidth: number;
  outputHeight: number;
  metersPerPixel: number;
  vectorLines?: DetectedLine[];
  vectorOpeningLines?: DetectedLine[];
  vectorArcs?: DetectedArc[];
}

export interface DetectedLine {
  start: SourcePoint;
  end: SourcePoint;
  confidence: number;
  thicknessPx?: number;
  evidence?: {
    pairedFaces?: boolean;
    overlapRatio?: number;
    thicknessConsistency?: number;
    pixelSupport?: number;
    coloredOpeningSupport?: number;
  };
}

export interface DetectedArc {
  start: SourcePoint;
  through: SourcePoint;
  end: SourcePoint;
  confidence: number;
  evidence?: {
    gradientSupport?: number;
    concentricPair?: boolean;
  };
}

export interface RecognizedTextHint {
  id: string;
  text: string;
  confidence: number;
  bounds: { x: number; y: number; width: number; height: number };
  suggestedDistanceM?: number;
  suggestedWallHeightM?: number;
}

export interface RecognitionIssue {
  id: string;
  severity: "warning" | "error";
  message: string;
  wallId?: string;
  openingId?: string;
  point?: SourcePoint;
}

export type RecognitionQualityStatus = "reliable" | "review" | "unreliable";

export interface RecognitionQualityReport {
  status: RecognitionQualityStatus;
  score: number;
  wallCount: number;
  arcCount: number;
  danglingEndpointCount: number;
  danglingEndpointRatio: number;
  isolatedWallCount: number;
  isolatedWallRatio: number;
  candidateExplosion: boolean;
  allowBatchAccept: boolean;
  reasons: string[];
}

export interface RecognitionDraft {
  engineVersion: string;
  source: PlanSource;
  vertices: ArchitectureVertex[];
  walls: ArchitecturalWall[];
  openings: ArchitecturalOpening[];
  textHints: RecognizedTextHint[];
  issues: RecognitionIssue[];
  quality?: RecognitionQualityReport;
}

export type RecognizerRequest =
  | { id: string; type: "recognize"; image: RecognitionImage; source: PlanSource; options: RecognitionOptions }
  | { id: string; type: "cancel" };

export type RecognizerResponse =
  | { id: string; type: "progress"; progress: RecognitionProgress }
  | { id: string; type: "result"; draft: RecognitionDraft }
  | { id: string; type: "cancelled" }
  | { id: string; type: "error"; message: string };

export const DEFAULT_RECOGNITION_OPTIONS: RecognitionOptions = {
  detectWalls: true,
  detectOpenings: true,
  detectArcs: false,
  recognizeText: true,
  defaultWallHeightM: 3,
  defaultWallThicknessM: 0.15,
  joinToleranceM: 0.08,
  minimumWallLengthM: 0.35,
};
