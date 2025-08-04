export interface JwtPayload {
  sub: string; // user id
  username: string;
  email: string;
  role: string;
  iat?: number; // issued at
  exp?: number; // expiration time
}
export interface AuthenticatedSocketPayload extends JwtPayload{
  profileImageUrl?:string
}