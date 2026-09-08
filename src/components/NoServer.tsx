import { useStore } from "../store";
import { IconTerminal } from "./icons";

export function NoServer() {
  const launchServer = useStore((s) => s.launchServer);
  const socket = useStore((s) => s.socket);
  return (
    <div className="empty" style={{ flex: 1 }}>
      <div className="glyph">
        <IconTerminal size={22} />
      </div>
      <h2>herdr server 未在运行</h2>
      <p>
        Herdr Studio 连接本机 herdr server 的 socket
        {socket ? (
          <>
            {" "}
            <code
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-dim)",
              }}
            >
              {socket.pointer}
            </code>
          </>
        ) : null}
        。启动 herdr 后点击重试。
      </p>
      <button className="primary-btn" onClick={() => void launchServer()}>
        启动 herdr
      </button>
    </div>
  );
}
