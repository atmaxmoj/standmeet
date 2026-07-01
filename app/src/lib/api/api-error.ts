// APIError —— 一个带 HTTP status + 机器码的前端错误，adminAPI 在响应非 2xx 时抛它（后端 envelope
// {error:{code,message}} 的前端镜像）。带 status 才能按业务分流：会话过期(401)→跳登录、冲突(409)→
// 表单就地提示、其余→toast。只有 message 的话调用方无从判断该怎么反显。
export class APIError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.code = code;
  }
}
