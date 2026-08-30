import {
  editContent,
  getCurrentPageMetadata,
  type PageMetadata,
} from "@canva/design";

export type PageIdentity = {
  key: string;
  source: "canva_page_id" | "content_fingerprint";
};

type Dependencies = {
  getMetadata: () => Promise<PageMetadata>;
  queryCurrentPage: typeof editContent;
};

const hash = (value: string): string => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
};

export const getCurrentPageIdentity = async (
  overrides: Partial<Dependencies> = {},
): Promise<PageIdentity> => {
  const dependencies: Dependencies = {
    getMetadata: getCurrentPageMetadata,
    queryCurrentPage: editContent,
    ...overrides,
  };
  const metadata = await dependencies.getMetadata();
  if (metadata.type === "absolute" && metadata.id) {
    return { key: `page:${metadata.id}`, source: "canva_page_id" };
  }

  const text: string[] = [];
  await dependencies.queryCurrentPage(
    { contentType: "richtext", target: "current_page" },
    (session) => {
      session.contents.forEach((range, index) => {
        if (!range.deleted) text.push(`${index}:${range.readPlaintext()}`);
      });
    },
  );
  const metadataPrefix =
    metadata.type === "absolute"
      ? `${metadata.title ?? ""}:${metadata.dimensions?.width ?? ""}:${metadata.dimensions?.height ?? ""}`
      : metadata.type;
  return {
    key: `fingerprint:${hash(`${metadataPrefix}\n${text.join("\n")}`)}`,
    source: "content_fingerprint",
  };
};
