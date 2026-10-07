/* Self-process memory accounting using the host SDK's Mach structure layout.
 * Compile for isolated probes: clang -dynamiclib -O2 this.c -o memory.dylib
 */
#include <mach/mach.h>
#include <mach/task_info.h>
#include <stdint.h>
#include <libproc.h>
#include <sys/resource.h>

int sample_process_memory(uint64_t out[4]) {
    task_vm_info_data_t info = {0};
    mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
    kern_return_t result = task_info(mach_task_self(), TASK_VM_INFO,
                                    (task_info_t)&info, &count);
    if (result != KERN_SUCCESS) return (int)result;
    if (count < TASK_VM_INFO_REV3_COUNT) return -1;
    out[0] = info.resident_size;
    out[1] = info.resident_size_peak;
    out[2] = info.phys_footprint;
    out[3] = info.ledger_phys_footprint_peak;
    return 0;
}

/* For an owned, still-running child. The kernel records its lifetime physical
 * peak, including temporary allocations missed by periodic RSS sampling. */
int sample_child_memory(int pid, uint64_t out[3]) {
    struct rusage_info_v4 info = {0};
    int result = proc_pid_rusage(pid, RUSAGE_INFO_V4, (rusage_info_t *)&info);
    if (result != 0) return result;
    out[0] = info.ri_resident_size;
    out[1] = info.ri_phys_footprint;
    out[2] = info.ri_lifetime_max_phys_footprint;
    return 0;
}
