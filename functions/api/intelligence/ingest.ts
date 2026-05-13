import { handleIntelligenceIngest, type IntelligenceStore } from '../../_shared/intelligence';

interface Env {
  CHRONOSCOPE_INTELLIGENCE?: IntelligenceStore;
}

export const onRequestPost: PagesFunction<Env> = (context) => {
  return handleIntelligenceIngest(context.request, {
    store: context.env.CHRONOSCOPE_INTELLIGENCE,
  });
};

export const onRequestOptions: PagesFunction<Env> = (context) => {
  return handleIntelligenceIngest(context.request);
};
