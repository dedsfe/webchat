import { ImageResponse } from "next/og";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#203c2a" }}>
      <div style={{ display: "flex", position: "relative", width: 104, height: 106 }}>
        <div style={{ position: "absolute", left: 12, top: 4, width: 84, height: 91, border: "6px solid #9dc0a7", borderRadius: 14 }} />
        <div style={{ position: "absolute", left: 0, top: 16, width: 84, height: 91, background: "#e9f1ea", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 44, height: 44, borderRadius: 22, border: "7px solid #37794b", display: "flex" }} />
        </div>
      </div>
    </div>,
    size,
  );
}
