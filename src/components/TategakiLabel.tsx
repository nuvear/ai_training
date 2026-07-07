// The signature vertical (縦書き) section label (DESIGN §5). Present on every
// major screen region; renders vertically in both locales so the signature
// survives EN and JA.
export function TategakiLabel({ children }: { children: React.ReactNode }) {
  return <div className="tate">{children}</div>;
}
