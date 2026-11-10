import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import {
  applyPreviewSectionProps,
  parseEditorToPreviewWindowEvent,
  postPreviewToEditorMessage,
  type PreviewSectionProps,
  type PreviewToEditorMessage,
} from "./preview-protocol";

export function usePreviewDocument(
  document: StorefrontPageDocument | undefined,
) {
  const [previewDocument, setPreviewDocument] = useState(document);
  const previewDocumentRef = useRef(previewDocument);
  const pendingPresentationAcksRef = useRef<
    Extract<
      PreviewToEditorMessage,
      { type: "morph:storefront-preview-section-presentation-ack" }
    >[]
  >([]);
  const [presentationCommitSequence, setPresentationCommitSequence] =
    useState(0);

  useLayoutEffect(() => {
    previewDocumentRef.current = document;
    setPreviewDocument(document);
  }, [document]);

  useLayoutEffect(() => {
    const pending = pendingPresentationAcksRef.current.splice(0);
    for (const ack of pending) postPreviewToEditorMessage(ack);
  }, [presentationCommitSequence, previewDocument]);

  useEffect(() => {
    const handlePreviewMessages = (event: MessageEvent<unknown>) => {
      const message = parseEditorToPreviewWindowEvent(event);
      if (!message) return;

      if (
        message.type === "morph:storefront-preview-set-section-order" &&
        Array.isArray(message.sectionIds) &&
        message.sectionIds.every((id) => typeof id === "string")
      ) {
        const sectionIds = message.sectionIds as string[];
        setPreviewDocument((current) => {
          if (!current || sectionIds.length !== current.sections.length) {
            return current;
          }

          const sectionsById = new Map(
            current.sections.map((section) => [section.id, section]),
          );
          const reorderedSections = sectionIds.flatMap((sectionId) => {
            const section = sectionsById.get(sectionId);
            return section ? [section] : [];
          });
          if (reorderedSections.length !== current.sections.length) {
            return current;
          }

          return { ...current, sections: reorderedSections };
        });
      }

      if (
        message.type === "morph:storefront-preview-update-section-props" &&
        typeof message.sectionId === "string"
      ) {
        const { sectionId, props, enabled, resetKeys, presentationToken } =
          message;
        const current = previewDocumentRef.current;
        const applied = current
          ? applyPreviewSectionProps(current, {
              sectionId,
              props: props as PreviewSectionProps | undefined,
              enabled: typeof enabled === "boolean" ? enabled : undefined,
              resetKeys,
            })
          : { document: current, matched: false };
        if (!applied.matched && !presentationToken) {
          if (current) {
            console.warn(
              `[morph] Live content update for section "${sectionId}" was dropped: the previewed page has no such section.`,
            );
          }
          return;
        }
        if (presentationToken) {
          const pending = pendingPresentationAcksRef.current;
          for (let index = pending.length - 1; index >= 0; index -= 1) {
            const previous = pending[index];
            if (
              previous?.token.sectionId === presentationToken.sectionId &&
              previous.status === "applied"
            ) {
              pending[index] = {
                ...previous,
                status: "not-applied",
                reason: "superseded",
              };
              break;
            }
          }
          pending.push(
            applied.matched
              ? {
                  type: "morph:storefront-preview-section-presentation-ack",
                  operationId: presentationToken.operationId,
                  token: presentationToken,
                  status: "applied",
                }
              : {
                  type: "morph:storefront-preview-section-presentation-ack",
                  operationId: presentationToken.operationId,
                  token: presentationToken,
                  status: "not-applied",
                  reason: "section-missing",
                },
          );
          setPresentationCommitSequence((sequence) => sequence + 1);
        }
        if (applied.matched) {
          previewDocumentRef.current = applied.document;
          setPreviewDocument(applied.document);
        }
      }
    };

    window.addEventListener("message", handlePreviewMessages);
    return () => window.removeEventListener("message", handlePreviewMessages);
  }, []);

  return previewDocument;
}
