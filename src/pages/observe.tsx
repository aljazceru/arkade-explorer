import { PageTransition } from "@/components/shared/page-transition";
import { ObservationDashboard } from "@/components/shared/observation-dashboard";

export function ObservePage() {
    return (
        <PageTransition>
            <ObservationDashboard />
        </PageTransition>
    );
}
