/**
 * @boring/viewers — headless viewers. One hook per experience holds its behaviour and its typed tools; the
 * person's controls and the agent call the same tools (VIEWERS-1). Data goes through a FileProvider from
 * @boring/files (in a page: `httpFiles` over the application's `fileRoutes`); the agent reaches a viewer
 * only through @boring/chat's page-command bridge. No styling here: the look is the registry's.
 */
export { call, defineTool, applied, proposed, committed, conflict, denied, stale, fromError, receiptEvidence, splitAddress, joinAddress, type ViewerTool, type ToolEffect, type ReceiptEvidence } from "./tool.ts";
export { createStore, type Store } from "./store.ts";
export { useViewerAgent, pageCommands, type AgentBinding } from "./agent.ts";
export { applyEdits, diffLines, headingsOf, type Edit, type EditsResult, type DiffLine, type Heading } from "./text.ts";
export { createFileTree, useFileTree, type FileTree, type FileTreeOptions, type UseFileTreeOptions, type FileTreeState, type TreeEntry, type TreeNode } from "./file-tree.ts";
export { createMarkdownDocument, useMarkdownDocument, type MarkdownDocument, type MarkdownOptions, type UseMarkdownOptions, type MarkdownState, type Proposal, type Selection } from "./markdown.ts";
export type { Effect, FileProvider, Receipt } from "@boring/files/web";
export { createImage, useImage, isImage, IMAGE_TYPES, ZOOM, type ImageViewer, type ImageOptions, type UseImageOptions, type ImageState, type Annotation } from "./image.ts";
export { createCanvasDocument, useCanvasDocument, serializeCanvas, parseCanvas, CANVAS_FORMAT, CANVAS_COLORS, CANVAS_TYPES, CANVAS_GEO, type CanvasDocument, type CanvasEditor, type CanvasOptions, type UseCanvasOptions, type CanvasState, type CanvasShape, type NewShape, type ShapeUpdate } from "./canvas.ts";
