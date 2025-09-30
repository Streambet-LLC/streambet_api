export interface ApiResponse<T = any> {
  message: string;
  status: number;
  data: T;
}
