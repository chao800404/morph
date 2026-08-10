import { RouteFormPage, useRouteModalClose, type RouteFormState } from "@/components/dialog/route-form-modal";
import { Spinner } from "@/components/ui/spinner";
import { updatePromotion } from "@/server/marketing/promotions.serverFn";
import { promotionQueries } from "@queries/marketing.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { promotionFields, promotionFormData } from "./promotion-form";

const PromotionEdit = () => {
  const { id } = useParams({ strict: false }) as { id: string }; const close = useRouteModalClose(); const queryClient = useQueryClient();
  const { data: result, isPending } = useQuery(promotionQueries.detail(id)); const promotion = result?.success ? result.data : null;
  if (isPending) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (!promotion) return null;
  const submit = async (_state: RouteFormState, formData: FormData): Promise<RouteFormState> => {
    const response = await updatePromotion({ data: { id, ...promotionFormData(formData, promotion) } });
    if (!response.success) { toast.error(response.message, { position: "top-center" }); return response; }
    await queryClient.invalidateQueries({ queryKey: promotionQueries.all() }); toast.success(response.message, { position: "top-center" }); close(); return response;
  };
  return <RouteFormPage title={`Edit ${promotion.code}`} description="Update the promotion and its application method." action={submit} submitLabel="Save" loadingLabel="Saving..." fieldsClassName="grid-cols-2" fields={promotionFields(promotion)} />;
};
export default PromotionEdit;
