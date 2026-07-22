import { Kbd } from "@/components/ui/kbd";

const TypeHeadClient = ({ size, title }: { size: number; title: string }) => {
    return (
        <div className="flex items-center h-12 px-6 justify-between">
            <Kbd>{title}</Kbd>
            {size > 0 && (
                <Kbd>
                    <span className="text-primary">{size}</span>
                    Selected
                </Kbd>
            )}
        </div>
    );
};

export default TypeHeadClient;
