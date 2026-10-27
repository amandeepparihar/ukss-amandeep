/**
 * Size Cascade Selects — Three cascading dropdowns: Size Options → Size Group → Actual Size.
 * Requirements: REQ-3.2, REQ-3.3, REQ-6.5
 */

import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';

export interface SizeSelection {
  optionId?: number;
  groupId?: number;
  sizeId?: number;
}

interface SizeCascadeSelectsProps {
  value: SizeSelection;
  onChange: (value: SizeSelection) => void;
  /** Override the wrapper div className — pass "contents" to make selects direct grid items */
  className?: string;
  /**
   * When provided, picking a size group will be checked against any size
   * group already attached to this product's existing inventory. If they
   * differ, the change is rejected with a toast (matches legacy SMS
   * `get_mapped_sizes_to_size_groups` validation).
   */
  productListsId?: number;
}

export function SizeCascadeSelects({ value, onChange, className, productListsId }: SizeCascadeSelectsProps) {
  // Size Options (brand) — always loaded
  const { data: sizeOptions } = useQuery({
    queryKey: ['products', 'size-options'],
    queryFn: async () => {
      const res = await api.get('/products/size-options');
      return res.data.data as Array<{ products_options_id: number; products_options_name: string }>;
    },
  });

  // Size Groups — filtered by selected option
  const { data: sizeGroups } = useQuery({
    queryKey: ['products', 'size-groups', value.optionId],
    queryFn: async () => {
      const res = await api.get('/products/size-groups', { params: { optionId: value.optionId } });
      return res.data.data as Array<{ sms_size_groups_id: number; size_group_name: string }>;
    },
    enabled: !!value.optionId,
  });

  // Actual Sizes — filtered by selected group
  const { data: sizes } = useQuery({
    queryKey: ['products', 'sizes', value.groupId],
    queryFn: async () => {
      const res = await api.get('/products/sizes', { params: { groupId: value.groupId } });
      return res.data.data as Array<{ manufacturers_sizes_to_default_sizes_id: number; manufacturer_size_shortname: string }>;
    },
    enabled: !!value.groupId,
  });

  return (
    <div className={className ?? 'grid grid-cols-1 md:grid-cols-3 gap-4'}>
      {/* Size Option */}
      <div className="space-y-2">
        <Label>Size Option</Label>
        <Select
          value={value.optionId ? String(value.optionId) : ''}
          onValueChange={(v) => {
            onChange({ optionId: Number(v), groupId: undefined, sizeId: undefined });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select brand..." />
          </SelectTrigger>
          <SelectContent>
            {sizeOptions?.map((opt) => (
              <SelectItem key={opt.products_options_id} value={String(opt.products_options_id)}>
                {opt.products_options_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Size Group */}
      <div className="space-y-2">
        <Label>Size Group</Label>
        <Select
          value={value.groupId ? String(value.groupId) : ''}
          onValueChange={async (v) => {
            const nextGroupId = Number(v);
            // Refuse a group that conflicts with the one already bound to this
            // product's existing inventory. Server enforces the same rule, but
            // the FE check gives the user immediate feedback.
            if (productListsId) {
              try {
                const res = await api.get('/products/check-size-group', {
                  params: { productListsId, sizeGroupId: nextGroupId },
                });
                const result = res.data.data as { ok: boolean; message?: string };
                if (!result.ok) {
                  toast.error(result.message ?? 'Size group conflicts with existing inventory');
                  return;
                }
              } catch {
                // Network error — fall through and let the server reject on submit.
              }
            }
            onChange({ ...value, groupId: nextGroupId, sizeId: undefined });
          }}
          disabled={!value.optionId}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select group..." />
          </SelectTrigger>
          <SelectContent>
            {sizeGroups?.map((g) => (
              <SelectItem key={g.sms_size_groups_id} value={String(g.sms_size_groups_id)}>
                {g.size_group_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Actual Size */}
      <div className="space-y-2">
        <Label>Size</Label>
        <Select
          value={value.sizeId ? String(value.sizeId) : ''}
          onValueChange={(v) => {
            onChange({ ...value, sizeId: Number(v) });
          }}
          disabled={!value.groupId}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select size..." />
          </SelectTrigger>
          <SelectContent>
            {sizes?.map((s) => (
              <SelectItem key={s.manufacturers_sizes_to_default_sizes_id} value={String(s.manufacturers_sizes_to_default_sizes_id)}>
                {s.manufacturer_size_shortname}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
