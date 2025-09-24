
export interface Point {
  x: number;
  y: number;
}

export interface Selection {
  id: string;
  start: Point;
  end: Point;
  locked?: boolean;
}
