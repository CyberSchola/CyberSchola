"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form";
import { z } from "zod"
import InputField from "../InputField";

/* Schema for Form validation */
const schema = z.object({

  user: z.string().min(1, { error: 'Class Name is required!' }),

  capacity: z.string().min(1, { message: 'Capacity is required!' }),

  grade: z.string().min(1, { message: 'Grade is required!' }),

  supervisor: z.string().min(1, { message: 'Supervisor is required!' }),

});

{ /* ZOD */ }
type Inputs = z.infer<typeof schema>


const ClassForm = ( { type, data }: { type: "create" | "update"; data?: any; }) => {
  
  { /* ZOD */ }
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Inputs> ({
    resolver: zodResolver(schema),
  });


  const onSubmit = handleSubmit( (data) => {
    console.log(data);
  } )

 
 return (
    
     /* FORM */ 
    <form className=" flex flex-col gap-8 " onSubmit={onSubmit} >

      { /* CONDITION FOR FORM HEADING */ }
      { type === "create" ? < h1 className="text-xl font-semibold">Create A New Class</h1> : < h1 className="text-xl font-semibold">Update Class</h1> }

      { /* FORM MODAL LABEL 1 */ }
      <span className="text-xs text-gray-400 font-medium">
        Class Full Information
      </span>

      { /* AUTHENTICATION INPUTS MAIN CONTAINER 1 */ }
      <div className="flex justify-between flex-wrap gap-4 ">

        { /* AUTHENTICATION INFROMATION INPUTS */ }

        <InputField label="Class Name" name="user" defaultValue= {data?.name} register={register} error={errors.user}  />   
         
        <InputField label="Capacity" name="capacity" defaultValue= {data?.capacity} register={register} error={errors.capacity} />

        <InputField label="Grade" name="grade" defaultValue= {data?.grade} register={register} error={errors.grade} />

        <InputField label="Supervisor" name="supervisor" defaultValue= {data?.supervisor} register={register} error={errors.supervisor} />  

      </div>
      

      { /* UPDATE AND CREATE BUTTON */ }
      <button className="bg-blue-400 text-white p-2 rounded-md">
        { type === "create" ? "Create" : "Update" }
      </button>

    </form>

  )
}

export default ClassForm