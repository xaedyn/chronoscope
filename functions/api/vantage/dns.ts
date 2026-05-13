import { handleDohDnsRequest } from '../../_shared/remote-vantage';

type Env = Record<string, never>;

export const onRequestGet: PagesFunction<Env> = (context) => {
  return handleDohDnsRequest(context.request);
};

export const onRequestOptions: PagesFunction<Env> = (context) => {
  return handleDohDnsRequest(context.request);
};
