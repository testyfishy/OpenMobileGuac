# session

Session-level logic: gesture recogniser, `PointerModel`, `KeyModel`, `Viewport`,
`RemoteDisplay`, `TextInputBridge`, clipboard bridge. `PointerModel`, `KeyModel`,
`Viewport` and the gesture recogniser are pure TypeScript with no DOM or Capacitor
imports, and ship with unit tests (see docs/SPEC.md §8.2).
