import { handleRemoteProbe } from '../../_shared/remote-vantage';

interface Env {}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  return handleRemoteProbe(context.request, {
    cf: context.request.cf,
  });
};

export const onRequestOptions: PagesFunction<Env> = async (context) => {
  return handleRemoteProbe(context.request);
};
