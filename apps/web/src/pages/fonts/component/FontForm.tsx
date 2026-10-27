import { CardContent, CardFooter } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { TextField } from "@/components/forms/TextField";
import { TextareaField } from "@/components/forms/TextareaField";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { UseFormReturn, Controller } from "react-hook-form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const API_URL = `${import.meta.env.VITE_API_URL}/fonts/download`;


export interface FontFormValues {
    fontName: string;
    fontDescription?: string;
    textCase: string;
    fontStyle: string;
    fontZipFile?: File | null;
}

interface FontFormProps {
    form: UseFormReturn<FontFormValues>;
    onSubmit: (data: FontFormValues) => void;
    formType: string;
    isLoading: boolean;
    isEdit?: boolean;
    currentZipFile?: string | null;
    currentFontFolder?: string | null;

}

const textCaseOptions = [
    { label: "UpperCase", value: "Upper" },
    { label: "LowerCase", value: "Lower" },
];

const fontStyleOptions = [
    { label: "Straight", value: "Straight" },
    { label: "Curve", value: "Curve" },
];



export default function FontForm({ form, onSubmit, formType, isLoading, isEdit = false, currentZipFile }: FontFormProps) {
    const navigate = useNavigate();
    const fileError = form.formState.errors.fontZipFile;
    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
                <CardContent className="space-y-4">

                    {/* First Row  */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                        {/* Font name  */}
                        <TextField
                            control={form.control}
                            name="fontName"
                            label="Font Name"
                            placeholder="e.g. Roboto"
                            required
                        />

                        {/* text case  */}
                        <div className="flex flex-col gap-2 ">
                            <Controller
                                name="textCase"
                                control={form.control}
                                render={({ field: { onChange, value }, fieldState: { error } }) => (
                                    <div className="flex flex-col gap-2">
                                        <label className={cn("text-sm font-semibold", error && "text-red-500"
                                        )}>
                                            Text Case <span className="text-red-500">*</span>
                                        </label>
                                        <Select
                                            value={value}
                                            onValueChange={onChange}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select text case" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {(
                                                    textCaseOptions?.map((option) => (
                                                        <SelectItem key={option.value} value={option.value.toString()}>
                                                            {option.label}
                                                        </SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                        {error && <span className="text-sm font-semibold text-red-500">{error.message}</span>}
                                    </div>
                                )}
                            />
                        </div>

                    </div>

                    {/* Second Row  */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                        {/* Font Style  */}
                        <div className="flex flex-col gap-2">
                            <Controller
                                name="fontStyle"
                                control={form.control}
                                render={({ field: { onChange, value }, fieldState: { error } }) => (
                                    <div className="flex flex-col gap-2">
                                        <label className={cn("text-sm font-semibold", error && "text-red-500")}>
                                            Font Style <span className="text-red-500">*</span>
                                        </label>
                                        <Select
                                            value={value}
                                            onValueChange={onChange}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select font style" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {(
                                                    fontStyleOptions?.map((option) => (
                                                        <SelectItem key={option.value} value={option.value.toString()}>
                                                            {option.label}
                                                        </SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                        {error && <span className="text-sm font-semibold text-red-500">{error.message}</span>}
                                    </div>

                                )}
                            />
                        </div>
                        {/* Zip Upload */}
                        <div className="flex flex-col gap-2">
                            <label className={cn("text-sm font-semibold", fileError && "text-red-500")}>
                                Font ZIP File
                                {!isEdit && (
                                    <span className="text-red-500">*</span>
                                )}
                            </label>

                            <div className="flex items-center gap-3">
                                <input type="file" accept=".zip" onChange={(e) => {
                                    const file = e.target.files?.[0] || null;
                                    form.setValue("fontZipFile", file);
                                }}
                                    className={cn(
                                        "border rounded-md px-3 py-2 text-sm w-full",
                                        fileError && "border-red-500"
                                    )}
                                />
                                {isEdit && currentZipFile && (
                                    <a href={`${API_URL}/${currentZipFile}`} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline whitespace-nowrap">
                                        {currentZipFile}
                                    </a>)
                                }
                            </div>
                            {fileError && (
                                <span className="text-sm font-semibold text-red-500">
                                    {fileError.message}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Description  */}
                    <TextareaField
                        control={form.control}
                        name="fontDescription"
                        label="Font Description"
                        placeholder="Enter font description"
                        rows={4}
                        required
                    />

                </CardContent>

                <CardFooter className="flex justify-end gap-3 border-t pt-6">

                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => navigate("/fonts")}
                    >
                        Cancel
                    </Button>

                    <Button
                        type="submit"
                        loading={isLoading}
                    >
                        {formType}
                    </Button>

                </CardFooter>
            </form>
        </Form>
    );
}