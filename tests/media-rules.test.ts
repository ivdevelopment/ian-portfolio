import { describe, expect, it } from "vitest";
import { MEDIA_RULES, checkUpload, isStoragePathForProject, storagePathFor } from "@/lib/media-rules";

const MiB = 1024 * 1024;
const file = (type: string, size: number, name = "f") => ({ type, size, name });

describe("checkUpload", () => {
  it("accepts supported types within their limits", () => {
    expect(checkUpload(file("image/png", 1 * MiB))).toMatchObject({ ok: true, type: "image", ext: "png" });
    expect(checkUpload(file("image/jpeg", 1 * MiB))).toMatchObject({ ok: true, ext: "jpg" });
    expect(checkUpload(file("image/webp", 1 * MiB))).toMatchObject({ ok: true });
    expect(checkUpload(file("image/gif", 5 * MiB))).toMatchObject({ ok: true, type: "gif" });
    expect(checkUpload(file("video/mp4", 40 * MiB))).toMatchObject({ ok: true, type: "video" });
  });

  it("rejects unsupported MIME types (incl. SVG and HTML)", () => {
    for (const type of ["image/svg+xml", "text/html", "application/pdf", "video/webm", ""]) {
      expect(checkUpload(file(type, 1000)).ok).toBe(false);
    }
  });

  it("rejects oversized and empty files", () => {
    expect(checkUpload(file("image/png", MEDIA_RULES["image/png"].maxBytes + 1)).ok).toBe(false);
    expect(checkUpload(file("image/gif", MEDIA_RULES["image/gif"].maxBytes + 1)).ok).toBe(false);
    expect(checkUpload(file("video/mp4", MEDIA_RULES["video/mp4"].maxBytes + 1)).ok).toBe(false);
    expect(checkUpload(file("image/png", 0)).ok).toBe(false);
  });

  it("restricts posters to still images", () => {
    expect(checkUpload(file("video/mp4", 1000), { imagesOnly: true }).ok).toBe(false);
    expect(checkUpload(file("image/gif", 1000), { imagesOnly: true }).ok).toBe(false);
    expect(checkUpload(file("image/jpeg", 1000), { imagesOnly: true }).ok).toBe(true);
  });
});

describe("storage paths", () => {
  const project = "11111111-1111-4111-8111-111111111111";
  const media = "22222222-2222-4222-8222-222222222222";

  it("builds stable, collision-free keys", () => {
    expect(storagePathFor(project, "png", media)).toBe(`projects/${project}/${media}.png`);
  });

  it("only accepts paths inside the project's own folder", () => {
    const own = storagePathFor(project, "mp4", media);
    expect(isStoragePathForProject(own, project)).toBe(true);
    expect(isStoragePathForProject(own, "99999999-9999-4999-8999-999999999999")).toBe(false);
    expect(isStoragePathForProject(`projects/${project}/../x.png`, project)).toBe(false);
    expect(isStoragePathForProject(`projects/${project}/${media}.svg`, project)).toBe(false);
    expect(isStoragePathForProject(`projects/${project}/nested/${media}.png`, project)).toBe(false);
  });
});
